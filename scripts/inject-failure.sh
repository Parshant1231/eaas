#!/usr/bin/env bash
# Injects ONE failure into a ready MEDIUM environment and measures how long the platform takes to
# detect it and recover. Writes recovery.json at the repo root. Runs inside the eaas-inject job.
#
# Failures: pod-kill service-crash node-kill cpu-spike disk-fill
set -euo pipefail

ENV_ID="${1:?usage: inject-failure.sh <env-id> <failure>}"
FAILURE="${2:?usage: inject-failure.sh <env-id> <failure>}"
[[ "$ENV_ID" =~ ^[a-z][a-z0-9-]{2,19}$ ]] || { echo "invalid env id" >&2; exit 1; }
[[ "$FAILURE" =~ ^(pod-kill|service-crash|node-kill|cpu-spike|disk-fill)$ ]] || { echo "invalid failure type" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="${EAAS_SSH_KEY:-$HOME/.ssh/eaas-jenkins-key}"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/eaas-${ENV_ID}.yaml}"
[[ -f "$KUBECONFIG" ]] || { echo "kubeconfig not found; run scripts/fetch-kubeconfig.sh ${ENV_ID}" >&2; exit 1; }
[[ -f "$KEY" ]] || { echo "ssh key not found: $KEY" >&2; exit 1; }

WORK="$(mktemp -d)"
RESULT="$ROOT/recovery.json"
PROBE_LOG="$WORK/probe.log"
rm -f "$RESULT"
: > "$PROBE_LOG"

# ---------------------------------------------------------------- state
# Every milestone is an epoch time in milliseconds; results are reported relative to T0 (the injection)
STEP="starting"
T0=""
INJECTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DETECT_MS=""; RECOVER_MS=""; REVERT_MS=""; RESTORE_MS=""; ALERT_MS=""
RECOVERED=false; GRAFANA=false; WRITTEN=false
TARGET="not injected"; MECHANISM=""; DEFINITION=""; NOTES=""; ALERT_NAME=""
SERVER_IP=""; AGENT_IP=""; AGENT_ID=""; AGENT_NODE=""
PROBE_PID=""
DETECT_PRED=""; RECOVER_PRED=""; ALERT_PRED=""
NEEDS_REVERT=false; REVERT_AT_MS=""; HOLD_AFTER_DETECT_S=""
DETECT_TIMEOUT_S=180; OBSERVE_TIMEOUT_S=300
INITIAL_PODS=""; VICTIM=""; RESTARTS_BEFORE=0
WAIT_MS=""
CPU_SECONDS=300

SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes -o ConnectTimeout=10)

# ---------------------------------------------------------------- helpers
now_ms() { date +%s%3N; }
say() { echo "[$(date -u +%H:%M:%S)] $*"; }
rel() { if [[ -n "${1:-}" && -n "$T0" ]]; then awk -v a="$T0" -v b="$1" 'BEGIN { printf "%.1f", (b - a) / 1000 }'; fi; }
k() { kubectl --request-timeout=15s "$@"; }
ssh_agent() { ssh "${SSH_OPTS[@]}" "ubuntu@${AGENT_IP}" "$@"; }

wait_until() { # wait_until <timeout-seconds> <command...>; sets WAIT_MS when the command first succeeds
  local timeout_s=$1 end
  shift
  end=$(( $(now_ms) + timeout_s * 1000 ))
  while (( $(now_ms) < end )); do
    if "$@"; then WAIT_MS=$(now_ms); return 0; fi
    sleep 1
  done
  return 1
}

mark_injected() {
  T0=$(now_ms)
  INJECTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  say "INJECTED: ${FAILURE} -> ${TARGET}"
}

# ---------------------------------------------------------------- cluster state predicates
deploy_ready() { # all desired replicas are ready and there are no extra ones
  local out spec ready total
  out=$(k -n app get deploy "$1" -o jsonpath='{.spec.replicas},{.status.readyReplicas},{.status.replicas}' 2>/dev/null) || return 1
  IFS=, read -r spec ready total <<<"$out"
  ready=${ready:-0}; total=${total:-0}
  [[ "$spec" =~ ^[0-9]+$ ]] && (( spec > 0 )) && (( ready == spec )) && (( total == spec ))
}
sts_ready() { [[ "$(k -n app get sts "$1" -o jsonpath='{.status.readyReplicas}' 2>/dev/null)" == "1" ]]; }
probe_ok() { curl -fsS -o /dev/null --max-time 3 "http://${SERVER_IP}:30080/api/hits" 2>/dev/null; }
node_status() { k get node "$1" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null; }
node_ready() { [[ "$(node_status "$1")" == "True" ]]; }
node_not_ready() { local s; s="$(node_status "$1")"; [[ -n "$s" && "$s" != "True" ]]; }
disk_pressure_status() { k get node "$AGENT_NODE" -o jsonpath='{.status.conditions[?(@.type=="DiskPressure")].status}' 2>/dev/null; }
pods_on_agent() { k -n app get pods -l "app=$1" --field-selector "spec.nodeName=${AGENT_NODE}" --no-headers 2>/dev/null | wc -l | tr -d ' '; }

alert_state() { # alert_state <alertname> <node>  -> firing | pending | none | unknown
  local raw
  raw=$(k get --raw '/api/v1/namespaces/monitoring/services/monitoring-kube-prometheus-prometheus:9090/proxy/api/v1/alerts' 2>/dev/null) || { echo unknown; return 0; }
  jq -r --arg a "$1" --arg i "$2" '
    [.data.alerts[]? | select(.labels.alertname == $a and ((.labels.instance // "") | contains($i))) | .state]
    | if any(.[]; . == "firing") then "firing" elif any(.[]; . == "pending") then "pending" else "none" end' <<<"$raw" 2>/dev/null || echo unknown
}

all_healthy() {
  local ready
  ready=$(k get nodes --no-headers 2>/dev/null | awk '$2 == "Ready" { c++ } END { print c + 0 }') || return 1
  (( ready == 2 )) && deploy_ready api && deploy_ready frontend && sts_ready postgres && probe_ok
}

ensure_spread() { # a node-loss test is meaningless if nothing runs on the worker
  if (( $(pods_on_agent api) >= 1 )) && (( $(pods_on_agent frontend) >= 1 )); then return 0; fi
  say "rebalancing: restarting api and frontend so replicas spread over both nodes"
  k -n app rollout restart deploy/api deploy/frontend > /dev/null
  k -n app rollout status deploy/api --timeout=180s > /dev/null
  k -n app rollout status deploy/frontend --timeout=180s > /dev/null
  (( $(pods_on_agent api) >= 1 )) && (( $(pods_on_agent frontend) >= 1 ))
}

# ---------------------------------------------------------------- failure-specific predicates
pod_replaced() { # a pod that did not exist before the injection has appeared
  local cur n
  cur=$(k -n app get pods -l app=api -o jsonpath='{.items[*].metadata.name}' 2>/dev/null) || return 1
  for n in $cur; do
    if [[ " $INITIAL_PODS " != *" $n "* ]]; then return 0; fi
  done
  return 1
}
api_recovered() {
  local cur
  cur=$(k -n app get pods -l app=api -o jsonpath='{.items[*].metadata.name}' 2>/dev/null) || return 1
  [[ " $cur " != *" $VICTIM "* ]] && deploy_ready api && probe_ok
}

agent_unit_info() { ssh_agent 'systemctl show -p ActiveState -p NRestarts k3s-agent' </dev/null 2>/dev/null; }
agent_restart_noticed() {
  local out state n
  out=$(agent_unit_info) || return 1
  state=$(awk -F= '$1 == "ActiveState" { print $2 }' <<<"$out"); n=$(awk -F= '$1 == "NRestarts" { print $2 }' <<<"$out")
  [[ "$state" != "active" ]] || { [[ "$n" =~ ^[0-9]+$ ]] && (( n > RESTARTS_BEFORE )); }
}
agent_restarted_ok() {
  local out state n
  out=$(agent_unit_info) || return 1
  state=$(awk -F= '$1 == "ActiveState" { print $2 }' <<<"$out"); n=$(awk -F= '$1 == "NRestarts" { print $2 }' <<<"$out")
  [[ "$state" == "active" && "$n" =~ ^[0-9]+$ ]] && (( n > RESTARTS_BEFORE )) && node_ready "$AGENT_NODE"
}

agent_not_ready() { node_not_ready "$AGENT_NODE"; }
agent_node_ready() { node_ready "$AGENT_NODE"; }
workloads_recovered() { deploy_ready api && deploy_ready frontend && probe_ok; }
node_down_alert_firing() { [[ "$(alert_state NodeDown "$AGENT_NODE")" == "firing" ]]; }

cpu_alert_firing() { [[ "$(alert_state HighCpu "$AGENT_NODE")" == "firing" ]]; }
cpu_alert_cleared() { [[ "$(alert_state HighCpu "$AGENT_NODE")" == "none" ]]; }

agent_disk_pressure() { [[ "$(disk_pressure_status)" == "True" ]]; }
agent_disk_pressure_cleared() { [[ "$(disk_pressure_status)" == "False" ]]; }

# ---------------------------------------------------------------- probe: the user's view of the service
start_probe() {
  (
    while true; do
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://${SERVER_IP}:30080/api/hits" 2>/dev/null || true)
      echo "$(now_ms) ${code:-000}" >> "$PROBE_LOG"
      sleep 1
    done
  ) &
  PROBE_PID=$!
}

# ---------------------------------------------------------------- reverting
do_revert() {
  [[ -n "$AGENT_IP" ]] || return 0
  case "$FAILURE" in
    cpu-spike) ssh_agent 'sudo systemctl stop eaas-chaos-cpu 2>/dev/null; sudo pkill -x stress-ng 2>/dev/null; true' </dev/null ;;
    disk-fill) ssh_agent 'sudo rm -f /var/tmp/eaas-chaos-fill' </dev/null ;;
    *) return 0 ;;
  esac
}

ensure_agent_running() {
  [[ -n "$AGENT_ID" ]] || return 0
  local state
  state=$(aws ec2 describe-instances --instance-ids "$AGENT_ID" --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null) || return 0
  if [[ "$state" == "stopped" ]]; then aws ec2 start-instances --instance-ids "$AGENT_ID" > /dev/null 2>&1 || true; fi
  return 0
}

restore_agent() {
  STEP="restoring the worker node"
  local state
  state=$(aws ec2 describe-instances --instance-ids "$AGENT_ID" --query 'Reservations[0].Instances[0].State.Name' --output text)
  case "$state" in
    running|pending) say "worker never went down, nothing to restore"; return 0 ;;
    stopping|shutting-down) timeout 420 aws ec2 wait instance-stopped --instance-ids "$AGENT_ID" ;;
  esac
  say "starting the worker node again"
  aws ec2 start-instances --instance-ids "$AGENT_ID" > /dev/null
  timeout 300 aws ec2 wait instance-running --instance-ids "$AGENT_ID"
  if wait_until 420 agent_node_ready; then
    RESTORE_MS=$WAIT_MS
    say "worker node Ready again at +$(rel "$RESTORE_MS")s"
  else
    NOTES="${NOTES:+$NOTES; }worker node did not return to Ready within 7 minutes"
  fi
  return 0
}

# ---------------------------------------------------------------- reporting
annotate_grafana() { # annotate_grafana <start-ms> <end-ms> <text>
  local pw payload
  pw=$(k -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' 2>/dev/null | base64 -d) || return 1
  [[ -n "$pw" ]] || return 1
  payload=$(jq -n --arg uid "eaas-${ENV_ID}" --argjson t "$1" --argjson te "$2" --arg text "$3" --arg f "$FAILURE" \
    '{ dashboardUID: $uid, time: $t, timeEnd: $te, tags: ["failure-injection", $f], text: $text }')
  printf 'user = "admin:%s"\n' "$pw" | curl -fsS -m 15 -K - -H 'Content-Type: application/json' -d "$payload" \
    "http://${SERVER_IP}:30300/api/annotations" > /dev/null
}

write_result() {
  local total failed
  read -r total failed < <(awk '{ t++; if ($2 != "200") f++ } END { print t + 0, f + 0 }' "$PROBE_LOG")
  jq -n \
    --arg env "$ENV_ID" --arg failure "$FAILURE" --arg target "$TARGET" --arg injected "$INJECTED_AT" \
    --arg detected "$(rel "$DETECT_MS")" --arg recovered_s "$(rel "$RECOVER_MS")" \
    --arg revert "$(rel "$REVERT_MS")" --arg restored "$(rel "$RESTORE_MS")" --arg alert "$(rel "$ALERT_MS")" \
    --arg alertname "$ALERT_NAME" \
    --argjson recovered "$RECOVERED" --argjson grafana "$GRAFANA" \
    --argjson failed "$failed" --argjson total "$total" \
    --arg mechanism "$MECHANISM" --arg definition "$DEFINITION" --arg notes "$NOTES" '
    def n: if . == "" then null else tonumber end;
    {
      env_id: $env, failure: $failure, target: $target, injected_at: $injected,
      detected_seconds: ($detected | n), recovered_seconds: ($recovered_s | n),
      revert_seconds: ($revert | n), restored_seconds: ($restored | n),
      alert_name: (if $alertname == "" then null else $alertname end), alert_seconds: ($alert | n),
      recovered: $recovered, failed_requests: $failed, total_requests: $total,
      mechanism: $mechanism, definition: $definition, grafana_annotated: $grafana, notes: $notes
    }' > "$RESULT"
  WRITTEN=true
}

finish() {
  STEP="reporting"
  local end_ms text
  end_ms="${RECOVER_MS:-$(now_ms)}"
  if [[ "$RECOVERED" == "true" ]]; then
    text="${FAILURE}: recovered in $(rel "$RECOVER_MS")s (${MECHANISM})"
  else
    text="${FAILURE}: NOT recovered within the observation window"
  fi
  if annotate_grafana "$T0" "$end_ms" "$text"; then GRAFANA=true; else say "could not annotate Grafana (not fatal)"; fi
  write_result
  echo "---- result ----"
  cat "$RESULT"
  [[ "$RECOVERED" == "true" ]] || exit 1
}

cleanup() {
  local rc=$?
  trap - EXIT
  set +e
  if [[ -n "$PROBE_PID" ]]; then kill "$PROBE_PID" 2>/dev/null; fi
  case "$FAILURE" in
    cpu-spike|disk-fill) do_revert ;;
    node-kill) ensure_agent_running ;;
  esac
  if [[ "$WRITTEN" != "true" ]]; then
    [[ -n "$NOTES" ]] || NOTES="aborted at step: ${STEP}"
    write_result
  fi
  rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 143' TERM INT HUP

# ---------------------------------------------------------------- the observation loop
# Polls until recovery (and the alert, if one is expected) or the timeout. Recovery is only
# evaluated after detection, so "everything still looks fine" right after the injection never counts.
observe() {
  local timeout_s=$1 end t
  end=$(( $(now_ms) + timeout_s * 1000 ))
  while (( $(now_ms) < end )); do
    t=$(now_ms)

    if [[ -n "$REVERT_AT_MS" && -z "$REVERT_MS" ]] && (( t >= REVERT_AT_MS )); then
      do_revert || true
      REVERT_MS=$(now_ms)
      say "fault reverted at +$(rel "$REVERT_MS")s"
    fi

    if [[ -z "$DETECT_MS" ]]; then
      if $DETECT_PRED; then
        DETECT_MS=$t
        say "detected at +$(rel "$DETECT_MS")s"
        if [[ -n "$HOLD_AFTER_DETECT_S" ]]; then REVERT_AT_MS=$(( t + HOLD_AFTER_DETECT_S * 1000 )); fi
      elif (( t - T0 > DETECT_TIMEOUT_S * 1000 )); then
        NOTES="not detected within ${DETECT_TIMEOUT_S}s"
        say "$NOTES"
        return 0
      fi
    fi

    if [[ -n "$ALERT_PRED" && -z "$ALERT_MS" ]]; then
      if $ALERT_PRED; then ALERT_MS=$t; say "alert ${ALERT_NAME} firing at +$(rel "$ALERT_MS")s"; fi
    fi

    if [[ -n "$DETECT_MS" && -z "$RECOVER_MS" ]]; then
      if [[ "$NEEDS_REVERT" != "true" || -n "$REVERT_MS" ]]; then
        if $RECOVER_PRED; then RECOVER_MS=$t; RECOVERED=true; say "recovered at +$(rel "$RECOVER_MS")s"; fi
      fi
    fi

    if [[ -n "$RECOVER_MS" ]] && [[ -z "$ALERT_PRED" || -n "$ALERT_MS" ]]; then return 0; fi
    sleep 1
  done
  [[ -n "$RECOVER_MS" ]] || NOTES="${NOTES:+$NOTES; }not recovered within ${timeout_s}s"
  [[ -z "$ALERT_PRED" || -n "$ALERT_MS" ]] || NOTES="${NOTES:+$NOTES; }alert ${ALERT_NAME} was not observed"
  return 0
}

# ---------------------------------------------------------------- preflight
preflight() {
  STEP="preflight"
  local size
  size=$(aws ec2 describe-vpcs --filters "Name=tag:project,Values=eaas" "Name=tag:env-id,Values=${ENV_ID}" \
    --query "Vpcs[0].Tags[?Key=='size']|[0].Value" --output text)
  if [[ "$size" != "medium" ]]; then
    NOTES="failure injection needs a medium environment (size tag is '${size}')"
    echo "$NOTES" >&2
    exit 2
  fi

  SERVER_IP="$("$ROOT/scripts/server-ip.sh" "$ENV_ID")"
  AGENT_IP="$("$ROOT/scripts/node-ip.sh" "$ENV_ID" agent)"
  AGENT_ID=$(aws ec2 describe-instances \
    --filters "Name=tag:project,Values=eaas" "Name=tag:env-id,Values=${ENV_ID}" "Name=tag:role,Values=agent" \
              "Name=instance-state-name,Values=pending,running" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text)
  [[ "$AGENT_ID" =~ ^i-[0-9a-f]{8,17}$ ]] || { NOTES="could not find the worker instance"; exit 2; }
  AGENT_NODE=$(k get nodes -l '!node-role.kubernetes.io/control-plane' -o jsonpath='{.items[*].metadata.name}')
  [[ "$AGENT_NODE" =~ ^[a-z0-9-]+$ ]] || { NOTES="expected exactly one worker node, found: '${AGENT_NODE}'"; exit 2; }

  ssh_agent 'true' </dev/null || { NOTES="cannot SSH to the worker node"; exit 2; }
  wait_until 120 all_healthy || { NOTES="environment is not healthy before the injection (nodes, api, frontend, postgres, endpoint)"; exit 2; }

  case "$FAILURE" in
    cpu-spike|node-kill)
      [[ "$(alert_state __preflight__ none)" != "unknown" ]] || { NOTES="Prometheus is not reachable through the Kubernetes API"; exit 2; } ;;
  esac
  case "$FAILURE" in
    node-kill|disk-fill)
      ensure_spread || { NOTES="could not spread api and frontend pods across both nodes"; exit 2; } ;;
  esac
  say "preflight OK: server ${AGENT_NODE%-node-*}, worker ${AGENT_NODE}"
}

# ---------------------------------------------------------------- the five failures
setup_pod_kill() {
  STEP="pod-kill"
  MECHANISM="Kubernetes Deployment controller replaces the deleted pod"
  DEFINITION="detected = a replacement pod appears; recovered = api Deployment has all replicas ready, the deleted pod is gone and the API answers through the frontend"
  INITIAL_PODS=$(k -n app get pods -l app=api -o jsonpath='{.items[*].metadata.name}')
  VICTIM=${INITIAL_PODS%% *}
  [[ -n "$VICTIM" ]] || { NOTES="no api pod found"; exit 2; }
  TARGET="pod/${VICTIM} on $(k -n app get pod "$VICTIM" -o jsonpath='{.spec.nodeName}')"
  DETECT_PRED=pod_replaced; RECOVER_PRED=api_recovered
  DETECT_TIMEOUT_S=120; OBSERVE_TIMEOUT_S=180
  mark_injected
  k -n app delete pod "$VICTIM" --wait=false > /dev/null
  return 0
}

setup_service_crash() {
  STEP="service-crash"
  MECHANISM="systemd Restart=always restarts the crashed k3s-agent"
  DEFINITION="detected = systemd notices the crash (unit leaves active or the restart counter increases); recovered = unit active again after a restart and the node reports Ready"
  TARGET="k3s-agent on ${AGENT_NODE}"
  RESTARTS_BEFORE=$(ssh_agent 'systemctl show -p NRestarts --value k3s-agent' </dev/null | tr -d '[:space:]')
  [[ "$RESTARTS_BEFORE" =~ ^[0-9]+$ ]] || { NOTES="could not read the k3s-agent restart counter"; exit 2; }
  DETECT_PRED=agent_restart_noticed; RECOVER_PRED=agent_restarted_ok
  DETECT_TIMEOUT_S=90; OBSERVE_TIMEOUT_S=150
  mark_injected
  ssh_agent 'sudo systemctl kill --kill-who=main --signal=SIGKILL k3s-agent' </dev/null
  return 0
}

setup_node_kill() {
  STEP="node-kill"
  MECHANISM="Kubernetes marks the node NotReady, evicts its pods after 30s and the Deployments recreate them on the other node"
  DEFINITION="detected = node reported NotReady; recovered = api and frontend have all replicas ready on the surviving node and the API answers; alert = NodeDown firing; restored = node restarted by the test and Ready again"
  TARGET="node ${AGENT_NODE} (${AGENT_ID}) powered off"
  ALERT_NAME=NodeDown
  DETECT_PRED=agent_not_ready; RECOVER_PRED=workloads_recovered; ALERT_PRED=node_down_alert_firing
  DETECT_TIMEOUT_S=240; OBSERVE_TIMEOUT_S=480
  mark_injected
  ssh_agent 'sudo shutdown -h now' </dev/null || true
  return 0
}

setup_cpu_spike() {
  STEP="cpu-spike"
  MECHANISM="Prometheus HighCpu alert (more than 80% busy for 2 minutes); the stress is removed by the test"
  DEFINITION="detected = HighCpu firing; recovered = HighCpu no longer active after the stress ended (fault held for ${CPU_SECONDS}s)"
  TARGET="all CPUs on ${AGENT_NODE} for ${CPU_SECONDS}s"
  ALERT_NAME=HighCpu
  ssh_agent 'sudo DEBIAN_FRONTEND=noninteractive bash -c "apt-get update -qq && apt-get install -y -qq stress-ng"' </dev/null > /dev/null
  ssh_agent 'sudo systemctl stop eaas-chaos-cpu 2>/dev/null; true' </dev/null
  DETECT_PRED=cpu_alert_firing; RECOVER_PRED=cpu_alert_cleared
  NEEDS_REVERT=true
  DETECT_TIMEOUT_S=280; OBSERVE_TIMEOUT_S=660
  mark_injected
  REVERT_AT_MS=$(( T0 + CPU_SECONDS * 1000 ))
  ssh_agent "sudo systemd-run --unit=eaas-chaos-cpu --collect stress-ng --cpu 0 --timeout ${CPU_SECONDS}s --quiet" </dev/null > /dev/null
  return 0
}

setup_disk_fill() {
  STEP="disk-fill"
  MECHANISM="kubelet reports DiskPressure at under 10% free and evicts pods; the test removes the file 45s after detection"
  DEFINITION="detected = DiskPressure True on the worker; recovered = DiskPressure False again after the file was removed (the kubelet holds the condition for at least 5 minutes by design)"
  TARGET="root disk on ${AGENT_NODE}, filled to 5% free"
  DETECT_PRED=agent_disk_pressure; RECOVER_PRED=agent_disk_pressure_cleared
  NEEDS_REVERT=true; HOLD_AFTER_DETECT_S=45
  DETECT_TIMEOUT_S=180; OBSERVE_TIMEOUT_S=780
  mark_injected
  ssh_agent 'sudo bash -s' <<'REMOTE'
set -euo pipefail
read -r size avail < <(df --output=size,avail -B1 / | tail -1)
need=$(( avail - size / 20 ))
if (( need < 1073741824 )); then echo "less than 1 GiB to fill, refusing" >&2; exit 3; fi
fallocate -l "$need" /var/tmp/eaas-chaos-fill
echo "filled $need bytes"
REMOTE
  return 0
}

# ---------------------------------------------------------------- main
preflight
STEP="starting the probe"
start_probe
sleep 3

case "$FAILURE" in
  pod-kill)      setup_pod_kill ;;
  service-crash) setup_service_crash ;;
  node-kill)     setup_node_kill ;;
  cpu-spike)     setup_cpu_spike ;;
  disk-fill)     setup_disk_fill ;;
esac

STEP="observing"
observe "$OBSERVE_TIMEOUT_S"

if [[ "$FAILURE" == "cpu-spike" ]]; then ALERT_MS="$DETECT_MS"; fi
if [[ "$FAILURE" == "node-kill" ]]; then restore_agent; fi
if [[ "$FAILURE" == "disk-fill" ]]; then k -n app delete pod --field-selector=status.phase=Failed > /dev/null 2>&1 || true; fi

finish
