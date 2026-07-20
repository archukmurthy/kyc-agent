export const WOLFSBERG_EXTRACTION_PROMPT = `You are a KYC compliance data extractor. Extract all available field values from this Wolfsberg CBDDQ questionnaire and return them as a JSON object.

Return ONLY valid JSON with no markdown, no backticks.
Map the questionnaire answers to these field IDs where possible:

{
  "legal_name": "string or null",
  "registered_address": "string or null",
  "incorporation_date": "string or null",
  "lei_number": "string or null",
  "parent_company": "string or null",
  "parent_jurisdiction": "string or null",
  "publicly_listed": "Yes/No or null",
  "listed_where": "string or null",
  "business_type": "string or null",
  "ubo_names": "string or null",
  "ubo_share_percentage": "string or null",
  "bearer_shares": "Yes/No or null",
  "offshore_banking_licence": "Yes/No or null",
  "regulatory_authority": "string or null",
  "employee_count": "string or null",
  "total_assets": "string or null",
  "non_resident_customers": "Yes/No or null",
  "top_non_resident_countries": "string or null",
  "business_areas": "array of active business areas",
  "correspondent_banking": "Yes/No or null",
  "services_other_fis": "Yes/No or null",
  "trade_finance": "Yes/No or null",
  "cross_border_remittances": "Yes/No or null",
  "deals_virtual_currency": "Yes/No or null",
  "virtual_currency_types": "string or null",
  "aml_programme_in_place": "Yes/No or null",
  "aml_team_size": "string or null",
  "aml_policy_board_approved": "Yes/No or null",
  "board_aml_reporting_frequency": "string or null",
  "aml_outsourced": "Yes/No or null",
  "aml_outsourced_to": "string or null",
  "abc_programme": "Yes/No or null",
  "pep_screening": "Yes/No or null",
  "pep_screening_method": "string or null",
  "adverse_media_screening": "Yes/No or null",
  "ubo_threshold_pct": "string or null",
  "edd_shell_banks": "string or null",
  "edd_peps": "string or null",
  "edd_virtual_currency": "string or null",
  "transaction_monitoring_method": "string or null",
  "suspicious_activity_reporting": "Yes/No or null",
  "fatf_rec16_compliance": "Yes/No or null",
  "sanctions_policy_board_approved": "Yes/No or null",
  "sanctions_lists_used": "string or null",
  "sanctions_screening_update_days": "string or null",
  "presence_in_sanctioned_countries": "Yes/No or null",
  "record_retention_period": "string or null",
  "kyc_quality_assurance": "Yes/No or null",
  "internal_audit_covers_aml": "Yes/No or null",
  "policies_updated_annually": "Yes/No or null",
  "prohibits_shell_banks": "Yes/No or null",
  "prohibits_anonymous_accounts": "Yes/No or null",
  "licence_suspended": "Yes/No or null",
  "regulatory_action": "Yes/No or null"
}

For each field: extract the actual answer from the questionnaire. If the question was not answered or not present, return null. Do not guess or fabricate. For Yes/No questions return "Yes" or "No" as strings.`;

/* ═══════════════════════════════════════════
   PER-DOCUMENT EXTRACTION PROMPTS

   Each prompt instructs Claude to read a PDF (or
   image, for org chart) and return a JSON array of
   {fieldId, value} objects. The keys returned are
   "generic" — mapEXTRACTION_KEY_TO_SCHEMA() below
   maps them onto the active schema's field IDs.
   ═══════════════════════════════════════════ */
export const CERT_EXTRACTION_PROMPT = `Extract the following from this Certificate of Incorporation or equivalent company registration document:
- legal_name: full registered legal name
- registration_number: company/registration number
- incorporation_date: date of incorporation (ISO format)
- registered_address: full registered address
- legal_form: company type (e.g. private limited, PLC)
- country_of_incorporation: country

Return as JSON array of {fieldId, value} objects. Only include fields actually present in the document. No markdown, no backticks.`;

export const LICENCE_EXTRACTION_PROMPT = `Extract the following from this regulatory licence or authorisation document:
- licence_number: licence or registration number
- regulatory_authority: name of the issuing regulator
- has_licence: always 'Yes' if this document exists
- regulated_status: type of authorisation if stated
- licence_date: date of issue if present
- permitted_activities: description of permitted activities if present

Return as JSON array of {fieldId, value} objects. No markdown, no backticks.`;

export const ANNUAL_REPORT_EXTRACTION_PROMPT = `Extract the following from this annual report or financial statements document:
- annual_turnover_band: revenue range (return as a descriptive string e.g. 'Over £250 million')
- employee_count_band: number of employees or band
- operating_countries: countries where the company operates
- business_description: what the company does
- publicly_listed: Yes or No based on whether shares are publicly traded
- listed_where: stock exchange name if listed
- total_assets: total assets value or band if stated
- payout_transaction_countries: countries they send payments to if mentioned
- directors: names of board directors if listed
- ubo_names: parent company or major shareholders if disclosed

Return as JSON array of {fieldId, value} objects. No markdown, no backticks.`;

export const ORG_CHART_EXTRACTION_PROMPT = `Extract the following from this ownership structure or org chart document:
- ubo_names: names of ultimate beneficial owners
- ubo_share_percentage: ownership percentages — return the EXACT text as stated (e.g. "75% or more", "25% to 50%", "Significant influence or control"). Do not convert, round, average a range, or strip qualifiers like "or more"/"to".
- group_structure: description of corporate structure
- parent_company: immediate parent company name if shown

Return as JSON array of {fieldId, value} objects. No markdown, no backticks.`;

export const AML_POLICY_EXTRACTION_PROMPT = `Extract the following from this AML policy document:
- aml_programme_in_place: always 'Yes' if this exists
- policies_updated_annually: Yes/No if stated
- pep_screening: Yes/No if PEP screening is mentioned
- transaction_monitoring_method: automated/manual/combination if stated
- suspicious_activity_reporting: Yes/No if stated
- record_retention_period: retention period if stated
- aml_policy_board_approved: Yes/No if stated

Return as JSON array of {fieldId, value} objects. No markdown, no backticks.`;
