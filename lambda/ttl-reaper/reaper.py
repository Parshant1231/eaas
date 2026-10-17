"""EaaS TTL reaper (AWS Lambda).

Runs every few minutes. For every environment whose expires-at tag is in the past:
  1. send a destroy request to SQS (the portal turns it into the Jenkins destroy job);
  2. if it is still running after a grace period, terminate its instances directly
     (the last resort that stops billing even when the machine running Jenkins is off).

AWS tags are the source of truth. Every run recomputes from scratch and remembers nothing,
so duplicate requests are expected and harmless.
"""
import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)

ENV_ID_RE = re.compile(r"^[a-z][a-z0-9-]{2,19}$")
EXPIRES_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
LIVE_STATES = ["pending", "running", "stopping", "stopped"]


@dataclass
class Environment:
    env_id: str
    expires_values: list = field(default_factory=list)
    instance_ids: list = field(default_factory=list)


def parse_expiry(value):
    """Returns an aware UTC datetime, or None if the value is missing or malformed."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, EXPIRES_FORMAT).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def tag_map(tags):
    return {t["Key"]: t["Value"] for t in (tags or []) if "Key" in t and "Value" in t}


def effective_expiry(env):
    """The latest valid expiry across the environment's resources.

    Extending a TTL rewrites several resources; if that was ever interrupted halfway,
    taking the latest value errs on the side of not destroying a live environment.
    """
    parsed = [p for p in (parse_expiry(v) for v in env.expires_values) if p is not None]
    return max(parsed) if parsed else None


def collect_environments(ec2):
    envs = {}

    def entry(env_id):
        return envs.setdefault(env_id, Environment(env_id=env_id))

    for page in ec2.get_paginator("describe_vpcs").paginate(
        Filters=[{"Name": "tag:project", "Values": ["eaas"]}]
    ):
        for vpc in page["Vpcs"]:
            tags = tag_map(vpc.get("Tags"))
            env_id = tags.get("env-id")
            if env_id and ENV_ID_RE.match(env_id):
                env = entry(env_id)
                if "expires-at" in tags:
                    env.expires_values.append(tags["expires-at"])

    for page in ec2.get_paginator("describe_instances").paginate(
        Filters=[
            {"Name": "tag:project", "Values": ["eaas"]},
            {"Name": "instance-state-name", "Values": LIVE_STATES},
        ]
    ):
        for reservation in page["Reservations"]:
            for instance in reservation["Instances"]:
                tags = tag_map(instance.get("Tags"))
                env_id = tags.get("env-id")
                if env_id and ENV_ID_RE.match(env_id):
                    env = entry(env_id)
                    env.instance_ids.append(instance["InstanceId"])
                    if "expires-at" in tags:
                        env.expires_values.append(tags["expires-at"])
    return envs


def plan_actions(envs, now, grace):
    """Pure decision function: what should happen right now."""
    actions = []
    for env_id in sorted(envs):
        env = envs[env_id]
        expiry = effective_expiry(env)
        if expiry is None:
            # Never act on something we cannot read
            actions.append({"action": "skip-no-valid-expiry", "envId": env_id})
            continue
        if expiry > now:
            continue
        actions.append(
            {"action": "request-destroy", "envId": env_id, "expiresAt": expiry.strftime(EXPIRES_FORMAT)}
        )
        if now - expiry >= grace and env.instance_ids:
            actions.append(
                {"action": "terminate-instances", "envId": env_id, "instanceIds": sorted(env.instance_ids)}
            )
    return actions


def log_event(event, **fields):
    LOG.info(json.dumps({"event": event, **fields}, sort_keys=True))


def run(envs, sqs, ec2, queue_url, now, grace, dry_run):
    actions = plan_actions(envs, now, grace)
    failures = 0
    for action in actions:
        kind = action["action"]
        env_id = action["envId"]
        try:
            if kind == "skip-no-valid-expiry":
                log_event("skipped", envId=env_id, reason="missing or unreadable expires-at tag")
            elif kind == "request-destroy":
                if dry_run:
                    log_event("would-request-destroy", envId=env_id, expiresAt=action["expiresAt"])
                else:
                    sqs.send_message(
                        QueueUrl=queue_url,
                        MessageBody=json.dumps(
                            {"envId": env_id, "reason": "expired", "expiresAt": action["expiresAt"]}
                        ),
                    )
                    log_event("destroy-requested", envId=env_id, expiresAt=action["expiresAt"])
            elif kind == "terminate-instances":
                if dry_run:
                    log_event("would-terminate", envId=env_id, instanceIds=action["instanceIds"])
                else:
                    ec2.terminate_instances(InstanceIds=action["instanceIds"])
                    log_event("instances-terminated", envId=env_id, instanceIds=action["instanceIds"])
        except Exception as exc:  # keep going: one failure must not block the other environments
            failures += 1
            LOG.error(json.dumps({"event": "action-failed", "action": kind, "envId": env_id, "error": type(exc).__name__}))
    if failures:
        # Fails the invocation so the Errors alarm fires
        raise RuntimeError(f"{failures} action(s) failed")
    return actions


def handler(event, context):
    import boto3  # imported here so the unit tests do not need boto3

    queue_url = os.environ["QUEUE_URL"]
    grace = timedelta(minutes=int(os.environ.get("GRACE_MINUTES", "30")))
    # Anything other than an explicit "false" means dry run (fail safe)
    dry_run = os.environ.get("DRY_RUN", "true").strip().lower() != "false"

    ec2 = boto3.client("ec2")
    sqs = boto3.client("sqs")
    now = datetime.now(timezone.utc)

    envs = collect_environments(ec2)
    log_event("scan", environments=len(envs), dryRun=dry_run, graceMinutes=int(grace.total_seconds() // 60))
    actions = run(envs, sqs, ec2, queue_url, now, grace, dry_run)
    return {"scanned": len(envs), "dryRun": dry_run, "actions": actions}
