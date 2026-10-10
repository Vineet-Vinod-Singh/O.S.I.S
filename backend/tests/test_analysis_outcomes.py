import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import incident_pipeline as demo
import real_incident_pipeline as real
from report_contract import OUTCOMES, finalize


class OutcomeTests(unittest.TestCase):
    def test_three_deterministic_outcomes_and_serialization(self):
        for scene, outcome in zip(("demo-arabian-sea", "demo-no-spill", "demo-inconclusive"), OUTCOMES):
            r = demo.analyze(scene)
            self.assertEqual(r["outcome"], outcome)
            self.assertEqual(r, demo.analyze(scene))
            self.assertIsNotNone(r["scene"]["footprint"])
            self.assertIn("evidenceProvenance", r)
            json.dumps(r, allow_nan=False)
            if outcome != "SPILL_DETECTED":
                self.assertIsNone(r["origin"])
                self.assertEqual(r["candidates"], [])

    def test_unavailable_real_and_upload_have_complete_contracts(self):
        scene, _ = real.load_scene("s1a-20240619-karnataka")
        for mode in ("REAL", "UPLOAD"):
            r = real.analyze({"mode": mode, "_scene": scene, "_unavailable": "Required data missing"})
            self.assertEqual(r["outcome"], "ANALYSIS_INCONCLUSIVE")
            self.assertEqual(r["mode"], mode)
            self.assertIsNone(r["age"])
            self.assertNotIn("synthetic_demo", json.dumps(r))
            if mode == "REAL":
                self.assertEqual(r["availability"], "REAL_DATA_UNAVAILABLE")

    def test_detector_uncertainty_does_not_attribute(self):
        scene, _ = real.load_scene("s1a-20240619-karnataka")
        detection = {"metrics": {"centroid": {"lat": 13.24, "lon": 74.74}}}
        sar = {"scene": scene, "detections": [detection],
               "mask": [], "detector": {"name": "classical", "outcome": "ANALYSIS_INCONCLUSIVE"}}
        with patch.object(real, "run_sar", return_value=sar), patch.object(real, "StrictEnvironmentProvider") as environment:
            r = real.analyze({"sceneId": scene["id"]})
        environment.assert_not_called()
        self.assertEqual(r["outcome"], "ANALYSIS_INCONCLUSIVE")
        self.assertEqual(r["candidates"], [])
        self.assertIsNone(r["spill"])
        self.assertEqual(r["candidateAnomalies"], [detection])

    def test_candidate_that_fails_gate_remains_candidate(self):
        scene, _ = real.load_scene("s1a-20240619-karnataka")
        detection = {
            "metrics": {"centroid": {"lat": 13.24, "lon": 74.74}},
            "passesOilEvidenceGate": False,
        }
        sar = {
            "scene": scene,
            "detections": [detection],
            "mask": [],
            "detector": {"name": "hybrid", "outcome": "ANALYSIS_INCONCLUSIVE"},
        }
        with patch.object(real, "run_sar", return_value=sar):
            report = real.analyze({"sceneId": scene["id"]})

        self.assertEqual(report["outcome"], "ANALYSIS_INCONCLUSIVE")
        self.assertIsNone(report["spill"])
        self.assertEqual(report["candidateAnomalies"], [detection])

    def test_gate_passing_detection_remains_positive_only_for_positive_outcome(self):
        scene, _ = real.load_scene("s1a-20240619-karnataka")
        passing = {"passesOilEvidenceGate": True, "metrics": {"centroid": {"lat": 13.24, "lon": 74.74}}}
        other = {"passesOilEvidenceGate": False}
        sar = {
            "scene": scene,
            "detections": [passing, other],
            "mask": [],
            "detector": {"name": "hybrid", "outcome": "SPILL_DETECTED"},
        }
        with patch.object(real, "run_sar", return_value=sar), \
                patch.object(real, "StrictEnvironmentProvider") as environment, \
                patch.object(real, "drift", return_value=[]):
            positive = real.analyze({"sceneId": scene["id"]})
        self.assertIs(positive["spill"], passing)
        self.assertEqual(positive["candidateAnomalies"], [other])
        environment.assert_called_once()

        sar["detector"]["outcome"] = "ANALYSIS_INCONCLUSIVE"
        with patch.object(real, "run_sar", return_value=sar), \
                patch.object(real, "StrictEnvironmentProvider") as environment:
            inconclusive = real.analyze({"sceneId": scene["id"]})
        self.assertEqual(inconclusive["outcome"], "ANALYSIS_INCONCLUSIVE")
        self.assertIsNone(inconclusive["spill"])
        self.assertEqual(inconclusive["candidateAnomalies"], [passing, other])
        environment.assert_not_called()

    def test_report_contract_moves_legacy_inconclusive_spill_to_candidates(self):
        legacy_spill = {"geometry": {"type": "Polygon", "coordinates": []}}
        report = {
            "mode": "REAL",
            "scene": {"bbox": None, "pixels": []},
            "spill": legacy_spill,
            "detector": {"outcome": "ANALYSIS_INCONCLUSIVE"},
            "stageStatus": {"detection": {"status": "completed"}},
        }

        finalized = finalize(report, "REAL")

        self.assertIsNone(finalized["spill"])
        self.assertEqual(finalized["candidateAnomalies"], [legacy_spill])

    def test_inconclusive_report_with_legacy_spill_failing_gate(self):
        """Inconclusive report with a legacy spill failing the oil gate must have spill=None and spill in candidates."""
        legacy_spill = {
            "geometry": {"type": "Polygon", "coordinates": [[[74.7, 13.2], [74.7, 13.3], [74.8, 13.2], [74.7, 13.2]]]},
            "passesOilEvidenceGate": False,
            "confidence": 0.65,
        }
        existing_candidate = {
            "geometry": {"type": "Polygon", "coordinates": []},
            "passesOilEvidenceGate": False,
            "confidence": 0.40,
        }
        report = {
            "mode": "REAL",
            "scene": {"bbox": [74.7, 13.2, 74.8, 13.3], "pixels": []},
            "spill": legacy_spill,
            "candidateAnomalies": [existing_candidate],
            "detector": {"outcome": "ANALYSIS_INCONCLUSIVE"},
            "stageStatus": {"detection": {"status": "completed"}},
        }
        finalized = finalize(report, "REAL")
        self.assertEqual(finalized["outcome"], "ANALYSIS_INCONCLUSIVE")
        self.assertIsNone(finalized["spill"])
        self.assertEqual(finalized["candidateAnomalies"], [legacy_spill, existing_candidate])

    def test_no_spill_report_with_no_detections(self):
        """No-spill report with no detections must have spill=None and empty candidateAnomalies."""
        report = {
            "mode": "REAL",
            "scene": {"bbox": [74.7, 13.2, 74.8, 13.3], "pixels": []},
            "spill": None,
            "detections": [],
            "candidateAnomalies": [],
            "detector": {"outcome": "NO_SPILL_DETECTED"},
            "stageStatus": {"detection": {"status": "completed"}},
        }
        finalized = finalize(report, "REAL")
        self.assertEqual(finalized["outcome"], "NO_SPILL_DETECTED")
        self.assertIsNone(finalized["spill"])
        self.assertEqual(finalized["candidateAnomalies"], [])

    def test_spill_detected_report_with_no_qualifying_detection(self):
        """Spill-detected report with no qualifying detection must not retain a confirmed spill."""
        unqualified = {
            "geometry": {"type": "Polygon", "coordinates": [[[74.7, 13.2], [74.7, 13.3], [74.8, 13.2], [74.7, 13.2]]]},
            "passesOilEvidenceGate": False,
            "confidence": 0.60,
        }
        report = {
            "mode": "REAL",
            "scene": {"bbox": [74.7, 13.2, 74.8, 13.3], "pixels": []},
            "spill": unqualified,
            "detections": [unqualified],
            "candidateAnomalies": [],
            "outcome": "SPILL_DETECTED",
            "detector": {"outcome": "SPILL_DETECTED"},
            "stageStatus": {"detection": {"status": "completed"}},
        }
        finalized = finalize(report, "REAL")
        self.assertIsNone(finalized["spill"])
        self.assertEqual(finalized["candidateAnomalies"], [unqualified])

    def test_valid_spill_detected_report_with_qualifying_detection(self):
        """Valid spill-detected report with qualifying detection must retain its spill."""
        qualifying = {
            "geometry": {"type": "Polygon", "coordinates": [[[74.7, 13.2], [74.7, 13.3], [74.8, 13.2], [74.7, 13.2]]]},
            "passesOilEvidenceGate": True,
            "confidence": 0.85,
        }
        other_candidate = {
            "geometry": {"type": "Polygon", "coordinates": []},
            "passesOilEvidenceGate": False,
        }
        report = {
            "mode": "REAL",
            "scene": {"bbox": [74.7, 13.2, 74.8, 13.3], "pixels": []},
            "spill": qualifying,
            "detections": [qualifying, other_candidate],
            "candidateAnomalies": [other_candidate],
            "outcome": "SPILL_DETECTED",
            "detector": {"outcome": "SPILL_DETECTED"},
            "stageStatus": {"detection": {"status": "completed"}},
        }
        finalized = finalize(report, "REAL")
        self.assertEqual(finalized["outcome"], "SPILL_DETECTED")
        self.assertEqual(finalized["spill"], qualifying)
        self.assertEqual(finalized["candidateAnomalies"], [other_candidate])

    def test_optional_ais_motion_does_not_invent_measurements(self):
        records, rejected = demo.normalize_ais([{"mmsi": "123456789", "timestamp": "2024-06-19T00:00:00Z", "latitude": 13.24, "longitude": 74.74}])
        self.assertEqual(rejected, 0)
        self.assertIsNone(records[0]["speed"])
        self.assertIsNone(records[0]["course"])


if __name__ == "__main__":
    unittest.main()