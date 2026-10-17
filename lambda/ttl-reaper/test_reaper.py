import json
import unittest
from datetime import datetime, timedelta, timezone

import reaper

NOW = datetime(2026, 10, 20, 12, 0, 0, tzinfo=timezone.utc)
GRACE = timedelta(minutes=30)


def make_env(env_id, expires=None, instances=("i-0a1",)):
    env = reaper.Environment(env_id=env_id)
    if expires is not None:
        env.expires_values.append(expires)
    env.instance_ids.extend(instances)
    return env


def kinds(actions):
    return [(a["action"], a["envId"]) for a in actions]


class FakeSqs:
    def __init__(self):
        self.sent = []

    def send_message(self, QueueUrl, MessageBody):
        self.sent.append((QueueUrl, json.loads(MessageBody)))


class FakeEc2:
    def __init__(self, fail=False):
        self.terminated = []
        self.fail = fail

    def terminate_instances(self, InstanceIds):
        if self.fail:
            raise RuntimeError("boom")
        self.terminated.append(list(InstanceIds))


class ParseTests(unittest.TestCase):
    def test_valid_and_invalid_expiry(self):
        self.assertEqual(reaper.parse_expiry("2026-10-20T13:00:00Z"), datetime(2026, 10, 20, 13, 0, tzinfo=timezone.utc))
        for bad in [None, "", "tomorrow", "2026-10-20 13:00:00", "2026-10-20T13:00:00", 5]:
            self.assertIsNone(reaper.parse_expiry(bad), repr(bad))

    def test_tag_map(self):
        self.assertEqual(reaper.tag_map([{"Key": "a", "Value": "1"}, {"Key": "b"}]), {"a": "1"})
        self.assertEqual(reaper.tag_map(None), {})


class PlanTests(unittest.TestCase):
    def test_not_expired_means_no_action(self):
        envs = {"web1": make_env("web1", "2026-10-20T12:00:01Z")}
        self.assertEqual(reaper.plan_actions(envs, NOW, GRACE), [])

    def test_expired_within_grace_only_requests_destroy(self):
        envs = {"web1": make_env("web1", "2026-10-20T11:50:00Z")}
        self.assertEqual(kinds(reaper.plan_actions(envs, NOW, GRACE)), [("request-destroy", "web1")])

    def test_expired_beyond_grace_also_terminates(self):
        envs = {"web1": make_env("web1", "2026-10-20T11:00:00Z", instances=("i-0b2", "i-0a1"))}
        actions = reaper.plan_actions(envs, NOW, GRACE)
        self.assertEqual(kinds(actions), [("request-destroy", "web1"), ("terminate-instances", "web1")])
        self.assertEqual(actions[1]["instanceIds"], ["i-0a1", "i-0b2"])

    def test_exactly_at_grace_boundary_terminates(self):
        envs = {"web1": make_env("web1", "2026-10-20T11:30:00Z")}
        self.assertIn(("terminate-instances", "web1"), kinds(reaper.plan_actions(envs, NOW, GRACE)))

    def test_vpc_only_environment_never_terminates(self):
        envs = {"web1": make_env("web1", "2026-10-20T10:00:00Z", instances=())}
        self.assertEqual(kinds(reaper.plan_actions(envs, NOW, GRACE)), [("request-destroy", "web1")])

    def test_missing_or_garbage_expiry_is_skipped_never_terminated(self):
        envs = {"a": make_env("a", None), "b": make_env("b", "soon")}
        self.assertEqual(kinds(reaper.plan_actions(envs, NOW, GRACE)), [("skip-no-valid-expiry", "a"), ("skip-no-valid-expiry", "b")])

    def test_latest_expiry_wins_when_resources_disagree(self):
        env = make_env("web1", "2026-10-20T11:00:00Z")
        env.expires_values.append("2026-10-20T13:00:00Z")  # an extension that reached only some resources
        self.assertEqual(reaper.plan_actions({"web1": env}, NOW, GRACE), [])

    def test_decisions_are_independent_per_environment(self):
        envs = {
            "alive": make_env("alive", "2026-10-20T14:00:00Z"),
            "gone": make_env("gone", "2026-10-20T11:00:00Z"),
        }
        self.assertEqual(kinds(reaper.plan_actions(envs, NOW, GRACE)), [("request-destroy", "gone"), ("terminate-instances", "gone")])


class RunTests(unittest.TestCase):
    def setUp(self):
        self.envs = {"web1": make_env("web1", "2026-10-20T11:00:00Z")}

    def test_dry_run_changes_nothing(self):
        sqs, ec2 = FakeSqs(), FakeEc2()
        reaper.run(self.envs, sqs, ec2, "q-url", NOW, GRACE, dry_run=True)
        self.assertEqual(sqs.sent, [])
        self.assertEqual(ec2.terminated, [])

    def test_live_run_sends_request_and_terminates(self):
        sqs, ec2 = FakeSqs(), FakeEc2()
        reaper.run(self.envs, sqs, ec2, "q-url", NOW, GRACE, dry_run=False)
        self.assertEqual(sqs.sent, [("q-url", {"envId": "web1", "reason": "expired", "expiresAt": "2026-10-20T11:00:00Z"})])
        self.assertEqual(ec2.terminated, [["i-0a1"]])

    def test_failure_is_reported_but_other_actions_still_run(self):
        sqs, ec2 = FakeSqs(), FakeEc2(fail=True)
        with self.assertRaises(RuntimeError):
            reaper.run(self.envs, sqs, ec2, "q-url", NOW, GRACE, dry_run=False)
        self.assertEqual(len(sqs.sent), 1)  # the destroy request still went out


if __name__ == "__main__":
    unittest.main()
