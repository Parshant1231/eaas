{
  "title": "EaaS environment: __ENV_ID__",
  "uid": "eaas-__ENV_ID__",
  "tags": ["eaas"],
  "annotations": {
    "list": [
      {
        "builtIn": 1,
        "datasource": { "type": "grafana", "uid": "-- Grafana --" },
        "enable": true,
        "hide": false,
        "iconColor": "rgba(0, 211, 255, 1)",
        "name": "Annotations & Alerts",
        "type": "dashboard"
      }
    ]
  },
  "schemaVersion": 39,
  "version": 1,
  "refresh": "10s",
  "time": { "from": "now-30m", "to": "now" },
  "panels": [
    {
      "id": 1, "type": "stat", "title": "Nodes up",
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "gridPos": { "h": 4, "w": 8, "x": 0, "y": 0 },
      "targets": [ { "refId": "A", "expr": "sum(up{job=\"node-exporter-host\"})" } ]
    },
    {
      "id": 2, "type": "stat", "title": "API pods ready",
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "gridPos": { "h": 4, "w": 8, "x": 8, "y": 0 },
      "targets": [ { "refId": "A", "expr": "sum(kube_deployment_status_replicas_ready{namespace=\"app\",deployment=\"api\"})" } ]
    },
    {
      "id": 3, "type": "stat", "title": "Container restarts (10m)",
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "gridPos": { "h": 4, "w": 8, "x": 16, "y": 0 },
      "targets": [ { "refId": "A", "expr": "sum(increase(kube_pod_container_status_restarts_total{namespace=\"app\"}[10m]))" } ]
    },
    {
      "id": 4, "type": "timeseries", "title": "Node CPU %",
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 4 },
      "fieldConfig": { "defaults": { "unit": "percent", "min": 0, "max": 100 }, "overrides": [] },
      "targets": [ { "refId": "A", "legendFormat": "{{instance}}", "expr": "100 - (avg by (instance) (rate(node_cpu_seconds_total{mode=\"idle\"}[2m])) * 100)" } ]
    },
    {
      "id": 5, "type": "timeseries", "title": "Node memory %",
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 4 },
      "fieldConfig": { "defaults": { "unit": "percent", "min": 0, "max": 100 }, "overrides": [] },
      "targets": [ { "refId": "A", "legendFormat": "{{instance}}", "expr": "(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100" } ]
    },
    {
      "id": 6, "type": "timeseries", "title": "Root disk %",
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 12 },
      "fieldConfig": { "defaults": { "unit": "percent", "min": 0, "max": 100 }, "overrides": [] },
      "targets": [ { "refId": "A", "legendFormat": "{{instance}}", "expr": "(1 - node_filesystem_avail_bytes{mountpoint=\"/\",fstype!=\"tmpfs\"} / node_filesystem_size_bytes{mountpoint=\"/\",fstype!=\"tmpfs\"}) * 100" } ]
    },
    {
      "id": 7, "type": "timeseries", "title": "API replicas (HPA)",
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 12 },
      "targets": [
        { "refId": "A", "legendFormat": "current", "expr": "kube_horizontalpodautoscaler_status_current_replicas{namespace=\"app\",horizontalpodautoscaler=\"api\"}" },
        { "refId": "B", "legendFormat": "desired", "expr": "kube_horizontalpodautoscaler_status_desired_replicas{namespace=\"app\",horizontalpodautoscaler=\"api\"}" }
      ]
    },
    {
      "id": 8, "type": "annolist", "title": "Failure injections (time to recover)",
      "gridPos": { "h": 8, "w": 24, "x": 0, "y": 20 },
      "options": {
        "onlyFromThisDashboard": true, "onlyInTimeRange": false, "tags": ["failure-injection"],
        "limit": 10, "showUser": false, "showTime": true, "showTags": true,
        "navigateBefore": "10m", "navigateAfter": "10m", "navigateToPanel": false
      }
    }
  ]
}
