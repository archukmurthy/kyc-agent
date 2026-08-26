import {
  UK_SCHEMA,
  SG_SCHEMA,
  UK_FI_SCHEMA,
  SG_FI_SCHEMA,
} from "../pipeline";
import { MANUAL_FORM_URL } from "../constants/appConstants";

// Built locally from the still-present hardcoded constants above. This is
// the offline fallback used only when /api/config is unreachable; the
// canonical source is the API endpoint, which seeds itself from the same
// data via lib/seedSchemas.js.
export const buildLocalDefaultConfig = () => ({
  _tenantId: "local",
  _version: 0,
  _seededAt: new Date().toISOString(),
  company: {
    name: "Demo",
    logo: null,
    manualFormUrl: MANUAL_FORM_URL,
    privacyPolicyUrl: "",
    submissionWebhookUrl: "",
    submissionEmail: "",
    primaryContactName: "",
    primaryContactEmail: "",
  },
  licences: [
    { id: "GB", jurisdictionCode: "GB", jurisdictionName: "United Kingdom", licenceType: "Payment Institution", licenceNumber: "", regulatoryAuthority: "FCA", countriesCovered: ["GB"], isPrimary: false },
    { id: "SG", jurisdictionCode: "SG", jurisdictionName: "Singapore", licenceType: "Major Payment Institution", licenceNumber: "", regulatoryAuthority: "MAS", countriesCovered: [], isPrimary: true },
  ],
  routingPolicy: "regional",
  entityTypes: [
    { id: "FI", label: "Financial Institution", description: "Banks, payment institutions, EMIs", icon: "🏦", active: true, sortOrder: 1 },
    { id: "Platform", label: "Platform", description: "Technology platforms and marketplaces", icon: "💻", active: true, sortOrder: 2 },
    { id: "Direct", label: "Direct", description: "Direct business customers", icon: "🏢", active: true, sortOrder: 3 },
    { id: "Corporate", label: "Corporate", description: "Corporate and commercial entities", icon: "🏛", active: true, sortOrder: 4 },
  ],
  schemas: {
    "Corporate:GB": { researchFields: UK_SCHEMA.researchFields, gapFields: UK_SCHEMA.gapFields },
    "Corporate:SG": { researchFields: SG_SCHEMA.researchFields, gapFields: SG_SCHEMA.gapFields },
    "FI:GB": { researchFields: UK_FI_SCHEMA.researchFields, gapFields: UK_FI_SCHEMA.gapFields },
    "FI:SG": { researchFields: SG_FI_SCHEMA.researchFields, gapFields: SG_FI_SCHEMA.gapFields },
    "Platform:GB": { researchFields: UK_SCHEMA.researchFields, gapFields: UK_SCHEMA.gapFields },
    "Platform:SG": { researchFields: SG_SCHEMA.researchFields, gapFields: SG_SCHEMA.gapFields },
    "Direct:GB": { researchFields: UK_SCHEMA.researchFields, gapFields: UK_SCHEMA.gapFields },
    "Direct:SG": { researchFields: SG_SCHEMA.researchFields, gapFields: SG_SCHEMA.gapFields },
  },
  sourceTiers: {
    primary: [],
    secondary: [],
    documentsArePrimary: true,
  },
  documents: {},
});
