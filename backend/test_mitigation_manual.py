from burst_detector import BurstEvent
from config import MitigationConfig
from mitigation_policy import MitigationPolicy
from tc_controller import TcController, TcError

def event(severity="moderate", source="192.0.2.10"):
    return BurstEvent(
        started_at_ms=100,
        ended_at_ms=None,
        peak_mbps=200,
        baseline_mbps=10,
        threshold_mbps=80,
        source_ip=source,
        contribution_pct=100,
        severity=severity,
        detection_delay_ms=None,
    )

def test_disabled_by_default():
    policy = MitigationPolicy(MitigationConfig())
    result = policy.on_burst(event())
    assert result.action == "none"
    assert result.cap_mbps is None
    print("PASS: automatic mitigation disabled by default")

def test_moderate_and_severe_caps():
    cfg = MitigationConfig(auto_enabled=True)
    policy = MitigationPolicy(cfg)
    moderate = policy.on_burst(event("moderate"))
    severe = policy.on_burst(event("severe"))
    assert moderate.cap_mbps == cfg.moderate_cap_mbps
    assert severe.cap_mbps == cfg.severe_cap_mbps
    print("PASS: severity selects configured cap")

def test_invalid_cap_fails_safe():
    cfg = MitigationConfig(auto_enabled=True, severe_cap_mbps=0)
    result = MitigationPolicy(cfg).on_burst(event("severe"))
    assert result.action == "fail"
    assert result.cap_mbps is None
    print("PASS: invalid cap rejected")

def test_plan_only():
    tc = TcController(interface="test0", dry_run=True)
    commands = tc.plan_source_cap("192.0.2.10", 35)
    assert len(commands) == 2
    assert any("flower src_ip 192.0.2.10" in cmd for cmd in commands)
    print("PASS: per-source plan contains classifier; no commands executed")

def test_invalid_inputs_rejected():
    tc = TcController(interface="test0", dry_run=True)
    for ip, rate in [("not-an-ip", 35), ("192.0.2.10", 0), ("192.0.2.10", 100001)]:
        try:
            tc.plan_source_cap(ip, rate)
        except TcError:
            continue
        raise AssertionError(f"Invalid input was accepted: {ip}, {rate}")
    print("PASS: invalid IP and rates rejected")

if __name__ == "__main__":
    test_disabled_by_default()
    test_moderate_and_severe_caps()
    test_invalid_cap_fails_safe()
    test_plan_only()
    test_invalid_inputs_rejected()
    print("All manual mitigation tests passed.")
