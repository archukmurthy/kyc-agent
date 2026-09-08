-- 013_idv_match.sql
-- Identity Discrepancy Bands feature (behind IDV_DISCREPANCY_BANDS_ENABLED).
-- Records each ID verification attempt (with a FROZEN snapshot of the selected
-- Companies House officer), each comparison decision (band A/B/C + outcome), and
-- any applicant explanation given during the Band B dialogue.
--
-- Append-only in spirit: decisions are never overwritten; a changed outcome is a
-- new row that supersedes the old one (via supersedes). The officer snapshot is
-- stored, never re-fetched, so we know exactly what we compared against.
--
-- Numbered 013 to avoid the 010-012 range reserved by a separate workstream.

CREATE TABLE IF NOT EXISTS idv_verification_attempts (
  id               TEXT PRIMARY KEY,
  application_id   TEXT NOT NULL,
  selected_officer JSONB NOT NULL,
  didit_session_id TEXT,
  status           TEXT NOT NULL DEFAULT 'created',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idv_attempts_application ON idv_verification_attempts (application_id);
CREATE INDEX IF NOT EXISTS idx_idv_attempts_session ON idv_verification_attempts (didit_session_id);

CREATE TABLE IF NOT EXISTS idv_match_decisions (
  id             TEXT PRIMARY KEY,
  attempt_id     TEXT NOT NULL REFERENCES idv_verification_attempts (id),
  band           TEXT NOT NULL CHECK (band IN ('A', 'B', 'C')),
  match_score    NUMERIC(5, 4),
  steps          JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_type   TEXT NOT NULL CHECK (outcome_type IN ('auto_match', 'same_person_variation_accepted', 'same_person_name_change_evidenced', 'registry_error_asserted', 'extraction_error_corrected', 'unresolved_to_review', 'demoted_to_loa_path')),
  basis          TEXT,
  policy_version TEXT NOT NULL,
  resolved_by    TEXT NOT NULL CHECK (resolved_by IN ('system', 'applicant-dialogue', 'reviewer')),
  supersedes     TEXT REFERENCES idv_match_decisions (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idv_decisions_attempt ON idv_match_decisions (attempt_id);

CREATE TABLE IF NOT EXISTS idv_applicant_explanations (
  id                    TEXT PRIMARY KEY,
  attempt_id            TEXT NOT NULL REFERENCES idv_verification_attempts (id),
  explanation_category  TEXT NOT NULL,
  free_text             TEXT,
  uploaded_document_ref TEXT,
  system_conclusion     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idv_explanations_attempt ON idv_applicant_explanations (attempt_id);
