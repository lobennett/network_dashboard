"""Descriptive summaries of canonical test-trial rows, never exclusion decisions."""

import math
from statistics import median


def numeric(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def summarize_behavior(rows):
    trials = [r for r in rows if r.get("trial_id") == "test_trial"]

    def summary(items):
        accuracy = [numeric(r.get("choice_acc")) for r in items]
        accuracy = [v for v in accuracy if v in (0, 1)]
        rt = [numeric(r.get("response_time")) for r in items]
        rt = [v for v in rt if v is not None and v > 0]
        return {
            "test_trials": len(items),
            "accuracy_denominator": len(accuracy),
            "choice_accuracy": sum(accuracy) / len(accuracy) if accuracy else None,
            "response_time_denominator": len(rt),
            "median_response_time_s": median(rt) if rt else None,
            "no_keypress_trials": sum(numeric(r.get("key_press")) == -1 for r in items),
            "go_omissions": sum(
                r.get("trial_type") == "go" and numeric(r.get("key_press")) == -1
                for r in items
            ),
        }

    return {
        **summary(trials),
        "by_condition": {
            c: summary(
                [r for r in trials if (r.get("trial_type") or "Unspecified") == c]
            )
            for c in sorted({r.get("trial_type") or "Unspecified" for r in trials})
        },
        "basis": "Canonical events after timing correction and scan clipping; trial_id=test_trial only. Accuracy uses recorded binary choice_acc. Response times use positive response_time values in seconds. No keypress includes intentional withholding and is not an omission rule.",
    }
