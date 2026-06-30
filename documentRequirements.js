/**
 * documentRequirements.js
 * Nium Document Requirements Service (DRS)
 * 
 * Pure function wrapper around the CDD Framework v26 rule engine.
 * No DOM dependencies. No LLM. Deterministic lookup only.
 * 
 * Usage:
 *   import { getRequirements, deriveOnboardingCountry } from './documentRequirements.js';
 * 
 *   const checklist = getRequirements({
 *     onboardingCountry,   // derived via deriveOnboardingCountry(incorporationCountry)
 *     incorporationCountry,
 *     entityType,          // 'Privately owned' | 'Publicly listed' | 'Partnership/LLP' | 'Trust' | 'State-owned enterprise' | 'Individuals'
 *     ownershipType,       // maps to entityType if no direct sector match
 *     sector,              // optional — send when available (Step 4 recompute)
 *   });
 * 
 * Returns: ChecklistItem[]
 *   { requirement, standardDocument, localEquivalent, why, analystStep,
 *     fallback, selfSource, rfi, mandatory, regulatoryRationale, sourceUrl }
 */

// ─── Data ────────────────────────────────────────────────────────────────────

const DATA = {"onboardingCountries":["Australia","Brazil","Canada","Hong Kong","India","Indonesia","Japan","Lithuania","Malaysia","Malta","Netherlands","New Zealand","Singapore","USA","United Arab Emirates","United Kingdom"],"incorpCountries":["Armenia","Australia","Austria","Belgium","Brazil","Bulgaria","Canada","China","Croatia","Cyprus","Czech Republic","Denmark","Estonia","Finland","France","Georgia","Germany","Greece","Hong Kong","Hungary","Iceland","India","Indonesia","Ireland","Italy","Japan","Kazakhstan","Latvia","Liechtenstein","Lithuania","Luxembourg","Malaysia","Malta","Netherlands","New Zealand","Norway","Poland","Portugal","Romania","Saudi Arabia","Singapore","Slovakia","Slovenia","Spain","Sweden","USA","United Arab Emirates","United Kingdom","Uzbekistan"],"entityTypes":["Individuals","Partnership/LLP","Privately owned","Publicly listed","State-owned enterprise","Trust"],"sectors": ["Bank / deposit-taking institution", "Crypto / VASP / digital assets", "Financial Institution - EMI / PI / PSP / MSB", "Financial Institution - bank / credit institution", "Financial Institution - broker / securities firm", "Financial Institution - distributor / agent / introducer", "Financial Institution - fund manager / asset manager", "Fintech - PSP / gateway / orchestration", "Fintech - lending / BNPL / credit", "Fund / asset management", "Marketplace / platform", "Other (General / non-regulated / commercial businesses)", "Payments / EMI / remittance", "Travel / OTA / travel payments", "Trust / fiduciary"],"registry":{"Brazil":{"registry":"Receita Federal / CNPJ","url":"https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp","legal":"Comprovante de Inscrição e de Situação Cadastral no CNPJ","constitution":"Contrato Social / Estatuto Social consolidado","ownership":"QSA (Quadro de Sócios e Administradores) + ownership chart","bo":"Declaração de Beneficiário Final / ownership chart to natural person UBO","address":"Comprovante de endereço / sede","id":"RG / CNH / Passport / RNM","tax":"CPF or CNPJ","notes":"Public CNPJ extract is strong for legal existence; BO typically still needs client-sourced ownership evidence."},"Canada":{"registry":"Canada's Business Registries / Corporations Canada","url":"https://ised-isde.canada.ca/cbr-rec/","legal":"Official corporate profile / registry extract","constitution":"Articles of Incorporation / Articles of Amendment / bylaws","ownership":"Register of individuals with significant control (ISC) or share register + ownership chart","bo":"ISC register / beneficial ownership declaration","address":"Registered office address proof / registry extract","id":"Passport / driver's licence / provincial photo card","tax":"SIN / tax number where applicable","notes":"Federal and provincial records vary; use the official registry profile and ask for client-side ownership records where needed."},"Saudi Arabia":{"registry":"Ministry of Commerce / Saudi Business Center / Commercial Register","url":"https://mc.gov.sa/en/eservices/Pages/ServiceDetails.aspx?sID=91","legal":"Commercial Registration extract / certificate","constitution":"Articles of Association / Memorandum of Association / company constitutional contract","ownership":"Shareholders Register + ownership chart","bo":"Beneficial owner register update / declaration + ownership chart","address":"Commercial Registration address extract / national address evidence","id":"Saudi National ID / Iqama / passport","tax":"TIN / tax registration where applicable","notes":"Use the Commercial Registration extract as the core legal-existence document, then pair it with constitutional documents, shareholder-register evidence and beneficial-owner information where required."},"Hong Kong":{"registry":"Companies Registry e-Search","url":"https://www.e-services.cr.gov.hk/ICRIS3EP/system/home.do","legal":"Company Particulars / Company Search Report","constitution":"Articles of Association","ownership":"Register of Members + group ownership chart","bo":"Significant Controllers Register extract / declaration","address":"Business Registration Certificate / registered office evidence","id":"HKID / passport","tax":"HKID / TIN where applicable","notes":"SCR is not generally public; analyst usually gets it from the client."},"Singapore":{"registry":"ACRA BizFile","url":"https://www.bizfile.gov.sg/ngbbizfileinternet/faces/oracle/webcenter/portalapp/pages/BizfileHomepage.jspx","legal":"ACRA BizFile Business Profile","constitution":"Constitution or M&AA","ownership":"Register of Members + group ownership chart","bo":"Controller / UBO declaration + ownership chart","address":"BizFile address extract","id":"NRIC / FIN / passport","tax":"NRIC / FIN / TIN where applicable","notes":"Controller register is maintained at the registered office and is not public."},"United Arab Emirates":{"registry":"Commercial registry / licensing authority","url":"https://u.ae/en/information-and-services/business/business","legal":"Trade Licence / Commercial Licence + registry extract","constitution":"Memorandum of Association / Articles","ownership":"Share register / MoA ownership pages + group chart","bo":"UBO register extract / UBO declaration","address":"Trade licence address / lease / Ejari where relevant","id":"Emirates ID / passport / residence permit","tax":"Emirates ID / tax registration where applicable","notes":"Registry evidence depends on free zone or mainland registrar; analysts often combine licence plus corporate documents."},"United Kingdom":{"registry":"Companies House","url":"https://find-and-update.company-information.service.gov.uk/","legal":"Companies House company overview / filing history extract","constitution":"Articles of Association","ownership":"PSC register + shareholding chart / register of members","bo":"PSC register / beneficial ownership declaration","address":"Utility bill / bank statement / council tax bill / government correspondence","id":"Passport / driving licence / national ID where accepted","tax":"National Insurance / TIN where applicable","notes":"PSC is public but should still be validated against the client-provided ownership chain."},"Austria":{"registry":"Firmenbuch","url":"https://justizonline.gv.at","legal":"Firmenbuchauszug","constitution":"Gesellschaftsvertrag / Satzung","ownership":"Gesellschafterliste / ownership chart","bo":"WiEReG-Auszug / BO declaration","address":"Firmenbuch address extract","id":"Passport / national ID","tax":"TIN","notes":"Use commercial register extract plus shareholder records."},"Belgium":{"registry":"Crossroads Bank for Enterprises (KBO/BCE)","url":"https://kbopub.economie.fgov.be/","legal":"KBO/BCE extract","constitution":"Coordinated articles / statuts coordonnés","ownership":"Share register / ownership chart","bo":"UBO Register extract / BO declaration","address":"KBO/BCE address extract","id":"Passport / eID","tax":"TIN","notes":"Public company data is easy to self-source; BO evidence often still needs client support."},"Bulgaria":{"registry":"Commercial Register","url":"https://portal.registryagency.bg/","legal":"Commercial Register current status extract","constitution":"Articles of Association / constitutive act","ownership":"Shareholders register / ownership chart","bo":"Beneficial owner declaration / register extract","address":"Registry address extract","id":"Passport / national ID","tax":"TIN","notes":"Use the Trade Register extract as the primary legal existence document."},"Croatia":{"registry":"Court Register","url":"https://sudreg.pravosudje.hr/","legal":"Izvadak iz sudskog registra","constitution":"Društveni ugovor / Statut","ownership":"Book of shares / ownership chart","bo":"Register of beneficial owners extract / declaration","address":"Court register address extract","id":"Passport / national ID","tax":"OIB","notes":"Registry extract is the starting point; BO still often comes via client declaration."},"Cyprus":{"registry":"Department of Registrar of Companies and Intellectual Property","url":"https://www.companies.gov.cy/","legal":"Company Search / Certificate of Incorporation","constitution":"Memorandum and Articles of Association","ownership":"Certificate of Shareholders + ownership chart","bo":"Beneficial owner declaration / register extract","address":"Registered office certificate","id":"Passport / national ID","tax":"TIN","notes":"Certificates of shareholders/directors are common local equivalents."},"Czech Republic":{"registry":"Commercial Register","url":"https://or.justice.cz/","legal":"Výpis z obchodního rejstříku","constitution":"Společenská smlouva / stanovy","ownership":"Shareholder list / ownership chart","bo":"Evidence of beneficial owners extract","address":"Commercial register address extract","id":"Passport / national ID","tax":"TIN","notes":"Use the Commercial Register extract and beneficial ownership register where available."},"Denmark":{"registry":"CVR","url":"https://datacvr.virk.dk/","legal":"CVR extract","constitution":"Vedtægter","ownership":"Ejerbog / ownership chart","bo":"Register of beneficial owners extract","address":"CVR address extract","id":"Passport / national ID","tax":"CPR/TIN","notes":"CVR is strong for legal existence and address verification."},"Estonia":{"registry":"e-Business Register","url":"https://ariregister.rik.ee/","legal":"e-Business Register extract","constitution":"Articles of Association","ownership":"Shareholder list / ownership chart","bo":"Beneficial owner register extract","address":"Registry address extract","id":"Passport / national ID","tax":"Personal code / TIN","notes":"The e-Business Register is reliable and easy to self-source."},"Finland":{"registry":"Trade Register","url":"https://virre.prh.fi/","legal":"Trade Register extract","constitution":"Articles of Association","ownership":"Shareholder register / ownership chart","bo":"Beneficial owner filing / extract","address":"Trade Register address extract","id":"Passport / national ID","tax":"TIN","notes":"Use PRH trade register data as the legal existence document."},"France":{"registry":"INPI / Registre national des entreprises","url":"https://data.inpi.fr/","legal":"Extrait Kbis","constitution":"Statuts","ownership":"Registre des mouvements de titres / share register + chart","bo":"Déclaration des bénéficiaires effectifs (DBE)","address":"Kbis registered office extract","id":"Passport / national ID","tax":"TIN","notes":"Kbis is the standard market document for French corporates."},"Germany":{"registry":"Handelsregister","url":"https://www.handelsregister.de/","legal":"Handelsregisterauszug","constitution":"Gesellschaftsvertrag / Satzung","ownership":"Gesellschafterliste / ownership chart","bo":"Transparenzregisterauszug / BO declaration","address":"Handelsregister address extract","id":"Passport / national ID","tax":"Steuer-ID / TIN","notes":"Handelsregister extract plus shareholder list is the standard pairing."},"Greece":{"registry":"GEMI","url":"https://www.businessregistry.gr/","legal":"GEMI certificate / extract","constitution":"Articles / company statute","ownership":"Shareholder register / ownership chart","bo":"Central Beneficial Owners Register extract / declaration","address":"GEMI address extract","id":"Passport / national ID","tax":"AFM","notes":"Use GEMI extract for legal existence and address."},"Hungary":{"registry":"Company Registry","url":"https://www.e-cegjegyzek.hu/","legal":"Cégkivonat","constitution":"Társasági szerződés / alapszabály","ownership":"Share register / ownership chart","bo":"UBO declaration","address":"Company extract address","id":"Passport / national ID","tax":"TIN","notes":"Company extract is the standard legal existence record."},"Ireland":{"registry":"Companies Registration Office","url":"https://core.cro.ie/","legal":"Company printout / CRO extract","constitution":"Constitution","ownership":"Register of Members + ownership chart","bo":"RBO extract / BO declaration","address":"CRO registered office extract","id":"Passport / driver's licence","tax":"PPSN / TIN","notes":"CRO printout is commonly used for registry verification."},"Italy":{"registry":"Registro delle Imprese","url":"https://www.registroimprese.it/","legal":"Visura camerale","constitution":"Atto costitutivo / statuto","ownership":"Libro soci / ownership chart","bo":"Beneficial owner declaration / BO evidence","address":"Visura camerale address extract","id":"Passport / national ID","tax":"Codice fiscale","notes":"Use the visura camerale as the primary legal existence extract."},"Latvia":{"registry":"Register of Enterprises","url":"https://info.ur.gov.lv/","legal":"Register of Enterprises extract","constitution":"Articles / memorandum","ownership":"Shareholder register / ownership chart","bo":"Beneficial owner entry / declaration","address":"Register address extract","id":"Passport / national ID","tax":"Personal code / TIN","notes":"Registry extract plus BO entry where available."},"Lithuania":{"registry":"Centre of Registers","url":"https://www.registrucentras.lt/","legal":"Legal Entity Register extract","constitution":"Articles of Association","ownership":"Shareholder list / ownership chart","bo":"JANGIS / beneficial owner declaration","address":"Register address extract","id":"Passport / national ID","tax":"Personal code / TIN","notes":"Use the legal entity extract and ask for shareholder records where needed."},"Luxembourg":{"registry":"RCS Luxembourg","url":"https://www.lbr.lu/","legal":"Extrait RCS","constitution":"Statuts coordonnés","ownership":"Register of shareholders / ownership chart","bo":"RBE extract / BO declaration","address":"RCS address extract","id":"Passport / national ID","tax":"TIN","notes":"RCS extract is standard; BO access changed after the 2022 CJEU ruling."},"Malta":{"registry":"Malta Business Registry","url":"https://registry.mbr.mt/","legal":"Company profile / MBR extract","constitution":"Memorandum & Articles of Association","ownership":"Register of members / ownership chart","bo":"Register of beneficial owners extract / declaration","address":"MBR registered office extract","id":"Passport / national ID","tax":"TIN","notes":"MBR profile is the standard self-source record."},"Netherlands":{"registry":"KvK","url":"https://www.kvk.nl/","legal":"KvK extract","constitution":"Articles of Association","ownership":"Shareholder register / ownership chart","bo":"UBO register extract / BO declaration","address":"KvK address extract","id":"Passport / national ID","tax":"BSN / TIN","notes":"Use the KvK extract for legal existence and address."},"Poland":{"registry":"KRS","url":"https://ekrs.ms.gov.pl/","legal":"KRS extract","constitution":"Articles / deed of association","ownership":"Shareholder register / ownership chart","bo":"CRBR extract / BO declaration","address":"KRS address extract","id":"Passport / national ID","tax":"PESEL / NIP","notes":"KRS and CRBR are the standard public sources."},"Portugal":{"registry":"Commercial Registry / Certidão Permanente","url":"https://eportugal.gov.pt/empresas/consultar-certidao-permanente","legal":"Certidão Permanente","constitution":"Pacto social / estatutos","ownership":"Shareholder register / ownership chart","bo":"RCBE extract / BO declaration","address":"Certidão Permanente address extract","id":"Passport / citizen card","tax":"NIF","notes":"Use the permanent certificate as the standard extract."},"Romania":{"registry":"National Trade Register Office","url":"https://portal.onrc.ro/","legal":"Certificate constatator / ONRC extract","constitution":"Act constitutiv","ownership":"Shareholder register / ownership chart","bo":"Beneficial owner declaration / ONRC evidence","address":"ONRC registered office extract","id":"Passport / national ID","tax":"CNP / TIN","notes":"Use ONRC extract as the core legal existence record."},"Slovakia":{"registry":"Commercial Register","url":"https://www.orsr.sk/","legal":"Výpis z obchodného registra","constitution":"Spoločenská zmluva / stanovy","ownership":"Shareholder register / ownership chart","bo":"Beneficial owner declaration","address":"Commercial register address extract","id":"Passport / national ID","tax":"Rodné číslo / TIN","notes":"Registry extract plus client BO declaration is standard."},"Slovenia":{"registry":"AJPES / Business Register","url":"https://www.ajpes.si/","legal":"AJPES / Business Register extract","constitution":"Act of establishment / articles","ownership":"Book of shareholders / ownership chart","bo":"Beneficial owner register extract / declaration","address":"Business Register address extract","id":"Passport / national ID","tax":"Davčna številka","notes":"Use AJPES extract as the legal existence source."},"Spain":{"registry":"Registro Mercantil","url":"https://www.rmc.es/","legal":"Nota simple / certificación del Registro Mercantil","constitution":"Escritura / estatutos","ownership":"Libro registro de socios / ownership chart","bo":"Declaración de titular real / BO declaration","address":"Registro Mercantil address extract","id":"Passport / national ID","tax":"NIF / NIE","notes":"Use the Mercantile Register extract and BO declaration where needed."},"Sweden":{"registry":"Bolagsverket","url":"https://bolagsverket.se/","legal":"Registration certificate","constitution":"Articles of Association","ownership":"Share register / ownership chart","bo":"Beneficial owner register extract","address":"Bolagsverket address extract","id":"Passport / national ID","tax":"Personnummer / TIN","notes":"Bolagsverket registration certificate is the normal registry extract."},"Georgia":{"registry":"National Agency of Public Registry (Entrepreneurial and Non-entrepreneurial Legal Entities Registry)","url":"https://enreg.reestri.gov.ge/main.php?l=en&m=new_index","legal":"Extract from the Registry of Entrepreneurs and Non-entrepreneurial Legal Entities","constitution":"Founding agreement / charter","ownership":"Registry extract showing owners / partners + ownership chart","bo":"Beneficial owner declaration + ownership chart tracing the full chain of ownership and control","address":"Registered address shown in the public registry extract","id":"Georgian national ID card / residence card / passport","tax":"Taxpayer Identification Number where applicable","notes":"Use the NAPR registry extract as the legal-existence document. For beneficial ownership, trace the full chain and obtain client-side support where registry information is incomplete."},"Armenia":{"registry":"State Register of Legal Entities","url":"https://www.e-register.am/","legal":"State Register of Legal Entities extract","constitution":"Charter / constituent agreement / foundation decision","ownership":"Shareholder or participant register + ownership chart","bo":"Beneficial owner declaration filed with the State Registry + ownership chart","address":"Registered address shown in the State Register extract","id":"Armenian national ID card / residence card / passport","tax":"TIN / taxpayer number where applicable","notes":"Use the State Register extract plus the beneficial-owner declaration and a client-sourced ownership chart."},"Kazakhstan":{"registry":"eGov / state registration database","url":"https://egov.kz/cms/en","legal":"Certificate or extract of state registration / re-registration of the legal entity","constitution":"Charter / foundation agreement / establishment decision","ownership":"Participant or shareholder register + ownership chart","bo":"Beneficial owner declaration + ownership chart tracing control to natural persons","address":"Registered address shown in the state registration extract","id":"Kazakh national ID card / residence permit / passport","tax":"BIN / IIN","notes":"Use the state-registration extract as the legal-existence record. Public BO transparency is limited, so request participant-register evidence and a client BO chart."},"Uzbekistan":{"registry":"Unified state register / government business services portal","url":"https://my.gov.uz/en","legal":"Extract from the state register of business entities / certificate of state registration","constitution":"Charter / constituent agreement / establishment decision","ownership":"Participant or shareholder register + ownership chart","bo":"Beneficial owner declaration + ownership chart tracing control to natural persons","address":"Registered address shown in the state registration extract","id":"Uzbek ID card / residence permit / passport","tax":"TIN / STIR","notes":"Use the official state-registration extract as the legal-existence document. Public BO records are limited, so combine it with participant-register evidence and a BO chart."},"USA":{"registry":"State Secretary of State / state business registry","url":"https://www.sba.gov/business-guide/launch-your-business/register-your-business","legal":"Secretary of State company extract / Certificate of Good Standing / equivalent state status document","constitution":"Articles of Incorporation / Certificate of Formation / Operating Agreement / bylaws, as applicable","ownership":"Cap table / register of members or shareholders + ownership chart","bo":"Beneficial ownership declaration / ownership chart tracing to natural persons","address":"State registry principal office / registered office extract or business address evidence","id":"U.S. passport / state driver's licence / state-issued photo ID card / foreign passport for non-U.S. persons","tax":"IRS EIN letter / SSN / ITIN where applicable","notes":"There is no single federal company registry. Use the state registry extract and, where needed, a Certificate of Good Standing or equivalent state status document. Do not rely on a public federal BOI filing for U.S. companies."},"Japan":{"registry":"Legal Affairs Bureau commercial / corporation registration","url":"https://www1.touki.or.jp/","legal":"Certificate of Registered Matters / Commercial Register extract (登記事項証明書)","constitution":"Articles of Incorporation (定款) / corporate seal registration certificate where execution authority is relevant","ownership":"Shareholder register (株主名簿) or members register + ownership chart","bo":"Beneficial ownership declaration + ownership chart tracing control to natural persons","address":"Registered head-office address shown on Certificate of Registered Matters / residence certificate / utility bill / lease / bank statement where individual address is required","id":"My Number Card / residence card / Japanese passport / foreign passport","tax":"Corporate Number / My Number where applicable","notes":"Use the Legal Affairs Bureau registration extract as the primary legal-existence record. Japan does not provide a simple public BO extract for all companies, so obtain a client-side ownership chart and supporting shareholder/member evidence."},"Indonesia":{"registry":"AHU Online / Ministry of Law legal-entity administration system","url":"https://ahu.go.id/pencarian/profil-pt","legal":"Deed of Establishment + latest Deed(s) of Amendment + MOLHR/MLOHR approval decree (SK Kemenkumham) + NIB + AHU company profile + company NPWP","constitution":"Deed of Establishment and latest Deed(s) of Amendment / Articles of Association, together with relevant MOLHR/MLOHR decree","ownership":"Shareholder register + ownership chart tracing through ownership layers to at least the second layer where a 25% ownership/control interest exists","bo":"Beneficial owner declaration / AHU BO filing evidence + ownership chart; if no natural-person UBO can reasonably be identified after look-through, obtain signed director UBO declaration","address":"Registered / operational address evidence where operational address differs from AHU / NIB / legal documents","id":"KTP / e-KTP for Indonesian residents; passport for non-residents or fallback; KITAS / KITAP as residency support","tax":"Company NPWP; NIK / personal tax ID where applicable","notes":"Indonesia MLRO standard: collect Deed of Establishment, latest amendments, relevant MOLHR/MLOHR decree, NIB and company NPWP as the legal entity document set. KTP/e-KTP is primary for residents; passport is primary for non-residents/fallback. Individual proof of address is generally not separately required where valid KTP is collected, but entity address evidence is needed where operational/registered address differs from legal documents. Apply 25% ownership/control threshold and trace ownership to at least the second layer where 25% ownership exists; if no UBO is identified after reasonable look-through, obtain signed director UBO declaration."},"Malaysia":{"registry":"Companies Commission of Malaysia (SSM)","url":"https://www.ssm-einfo.my/","legal":"SSM Company Profile / company search extract","constitution":"Constitution / Memorandum and Articles where applicable","ownership":"Register of members + ownership chart","bo":"SSM beneficial ownership information / BO declaration + ownership chart","address":"Registered office address shown in SSM profile / utility bill / tenancy agreement / bank statement where individual address is required","id":"MyKad / MyPR / passport / MyKAS where applicable","tax":"TIN / NRIC / passport number where applicable","notes":"Use the SSM company profile as the core legal-existence record. BO information exists under Malaysia’s BO reporting framework, but access may require the company registration number and appropriate authority/consent; obtain client-side BO evidence where needed."},"Australia":{"registry":"Australian Securities and Investments Commission (ASIC)","url":"https://asic.gov.au/online-services/search-asics-registers/","legal":"ASIC Current Company Extract / Organisation Extract","constitution":"Constitution / replaceable rules / partnership agreement where applicable","ownership":"Share register / ownership chart","bo":"Beneficial owner declaration + ownership chart tracing control to natural persons","address":"Registered office address shown in ASIC extract","id":"Australian passport / driver's licence / Photo Card / Medicare card supplemented by photo ID","tax":"ABN / TFN where applicable","notes":"Use the ASIC company extract as the primary legal-existence record. AUSTRAC AML/CTF Rules require a risk-based approach to customer and BO identification; obtain client-side ownership evidence where the share register is not public. Director photo ID may be collected where required for person-level verification, but Director Identification Number is not a mandatory DD collection item in this tool unless the AU MLRO confirms new ICDD future-state applicability; treat any ICDD Director ID Number references as future-state guidance, not current mandatory collection."},"New Zealand":{"registry":"New Zealand Companies Office","url":"https://companies-register.companiesoffice.govt.nz/","legal":"NZ Companies Office company extract","constitution":"Constitution","ownership":"Register of shareholders / ownership chart","bo":"Beneficial owner declaration + ownership chart tracing control to natural persons","address":"Registered office address shown in Companies Office extract","id":"NZ passport / NZ driver licence / Kiwi Access Card","tax":"NZBN / IRD number where applicable","notes":"Companies Office data is publicly searchable for legal existence; client-side ownership evidence usually still required to map BO."},"India":{"registry":"Ministry of Corporate Affairs (MCA21)","url":"https://www.mca.gov.in/content/mca/global/en/mca/master-data/MDS.html","legal":"MCA Master Data / Certificate of Incorporation / Registrar of Companies extract","constitution":"Memorandum of Association (MoA) and Articles of Association (AoA)","ownership":"Register of Members + shareholding pattern + ownership chart","bo":"Significant Beneficial Owner (SBO) declaration (Form BEN-2 / Form MGT-7 disclosures) + ownership chart","address":"Registered office address per MCA records / utility bill / lease for individual address","id":"PAN / Aadhaar / Passport / Voter ID / Driving Licence (use OVD list)","tax":"PAN / GSTIN where applicable","notes":"Use MCA Master Data + RoC extract for legal existence. India operates a Significant Beneficial Owner (SBO) regime under Companies Act §90 — request the BEN-2 filing or BO declaration. RBI Master Direction KYC governs CDD for regulated entities."},"Iceland":{"registry":"Iceland Companies Register (Fyrirtækjaskrá)","url":"https://www.skatturinn.is/english/","legal":"Companies Register extract","constitution":"Articles of Association","ownership":"Share register / ownership chart","bo":"Beneficial owner register extract / declaration","address":"Companies Register address extract","id":"Passport / national ID","tax":"Kennitala / TIN","notes":"Use Companies Register extract as the primary record; BO register access has been restricted post-2022 CJEU ruling."},"Liechtenstein":{"registry":"Office of Justice / Commercial Register (Handelsregister)","url":"https://www.oera.li/","legal":"Commercial Register extract (Handelsregisterauszug)","constitution":"Statutes / Articles","ownership":"Shareholder / member register + ownership chart","bo":"Beneficial owner register extract / declaration","address":"Commercial Register address extract","id":"Passport / national ID","tax":"TIN","notes":"Liechtenstein commercial register is the core legal-existence document; BO access is controlled and may require a legitimate-interest application."},"Norway":{"registry":"Brønnøysund Register Centre (Foretaksregisteret)","url":"https://www.brreg.no/","legal":"Register of Business Enterprises extract (Firmaattest)","constitution":"Articles of Association (Vedtekter)","ownership":"Shareholder register / ownership chart","bo":"Beneficial owner register / declaration","address":"Brønnøysund registered address extract","id":"Passport / national ID","tax":"Organisasjonsnummer / TIN","notes":"The Firmaattest is the standard registry extract for Norwegian legal entities."},"China":{"registry":"National Enterprise Credit Information Publicity System (国家企业信用信息公示系统)","url":"https://www.gsxt.gov.cn/index.html","legal":"National Enterprise Credit Information Publicity System enterprise record / Business Licence (营业执照)","constitution":"Articles of Association (公司章程)","ownership":"Shareholder / partner register + ownership chart","bo":"Beneficial ownership information filing evidence / BO declaration + ownership chart","address":"Registered address shown on the National Enterprise Credit Information Publicity System record / lease or utility evidence where person-level address is required","id":"PRC Resident Identity Card / Chinese passport / Foreign Permanent Resident ID Card / foreign passport","tax":"Unified Social Credit Code / Taxpayer Identification Number where applicable","notes":"Use the National Enterprise Credit Information Publicity System as the self-source legal-existence register. BO information is reported under the PBOC/SAMR BO regime but is not a simple public extract; obtain client-side BO declaration and ownership chart. Official Chinese name or Unified Social Credit Code is normally needed for lookup."}},"citations":{"Saudi Arabia":{"code":"KSA-AMLR / KSA-MOC","title":"SAMA AML Implementing Regulation + Ministry of Commerce CR / BO services","locus":"CDD, beneficial ownership, commercial registration and BO records","url":"https://rulebook.sama.gov.sa/en/implementing-regulation-anti-money-laundering-law-0"},"Singapore":{"code":"SG-PSN01","title":"MAS Notice PSN01","locus":"CDD, beneficial ownership and EDD","url":"https://www.mas.gov.sg/regulation/notices/psn01-aml-cft-notice---specified-payment-services"},"United Kingdom":{"code":"UK-MLR17","title":"Money Laundering Regulations 2017","locus":"Regulation 28 CDD, Regulation 5 BO, Regulation 33 EDD","url":"https://www.legislation.gov.uk/id/uksi/2017/692"},"Hong Kong":{"code":"HK-AMLO","title":"AMLO Schedule 2","locus":"CDD and beneficial ownership requirements","url":"https://www.elegislation.gov.hk/hk/cap615"},"United Arab Emirates":{"code":"UAE-AML20 / UAE-CAB58","title":"Federal Decree-Law 20 of 2018 + Cabinet Decision 58/2020","locus":"CDD and UBO obligations","url":"https://www.centralbank.ae/en/our-operations/anti-money-laundering-aml/"},"Canada":{"code":"CA-FINTRAC","title":"FINTRAC entity identification and beneficial ownership guidance","locus":"Entity verification, persons authorised to give instructions, beneficial ownership and reasonable measures","url":"https://fintrac-canafe.canada.ca/guidance-directives/client-clientele/guide11/11-eng"},"Brazil":{"code":"BR-BCB-3978 / BR-BCB-96","title":"Circular BCB 3.978/2020 + Resolução BCB 96/2021","locus":"AML/CFT controls and payment account opening requirements","url":"https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=3978&tipo=Circular"},"EU":{"code":"EU-AMLD / EU-BRIS / EU-BORIS","title":"EU AML framework + BRIS + BORIS","locus":"EU beneficial ownership and business register framework","url":"https://e-justice.europa.eu/topics/registers-business-insolvency-land/business-registers-search-company-eu_en"},"Georgia":{"code":"GE-BO-RULE / GE-NAPR","title":"Georgia BO identification rule + NAPR business registry","locus":"Full-chain BO identification and legal-person verification using registry extracts","url":"https://enreg.reestri.gov.ge/main.php?l=en&m=new_index"},"Armenia":{"code":"AM-AML / AM-BO","title":"Armenia AML/CFT Law + CBA BO guidance","locus":"CDD, BO determination and BO declaration filing with the State Registry","url":"https://www.e-register.am/"},"Kazakhstan":{"code":"KZ-AML / KZ-REG","title":"Kazakhstan AML framework + state registration evidence","locus":"CDD, beneficial ownership due diligence and official state-registration evidence","url":"https://egov.kz/cms/en"},"Uzbekistan":{"code":"UZ-AML / UZ-REG","title":"Uzbekistan AML/CFT framework + official state-registration evidence","locus":"CDD, beneficial ownership due diligence and official state-registration evidence","url":"https://my.gov.uz/en"},"USA":{"code":"US-CIP / US-CDD / US-BOI","title":"31 CFR 1020.220 CIP + FinCEN CDD Rule / 2026 exceptive relief + 2025 BOI interim final rule","locus":"Risk-based customer identification, legal-entity customer CDD and no public federal BOI filing requirement for U.S. companies","url":"https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1020/subpart-B/section-1020.220"},"Japan":{"code":"JP-APTCP / JP-LAB","title":"Japan FSA AML/CFT Guidelines + Legal Affairs Bureau commercial registration","locus":"CDD, risk-based AML/CFT controls and commercial / corporation registration evidence","url":"https://www.fsa.go.jp/common/law/amlcft/211122_en_amlcft_guidelines.pdf"},"Indonesia":{"code":"ID-OJK / ID-BI / ID-AHU","title":"OJK AML/CFT regulation update + AHU corporate / BO framework","locus":"CDD, BO identification and AHU legal-entity / beneficial ownership evidence","url":"https://ojk.go.id/en/berita-dan-kegiatan/siaran-pers/Pages/OJK-Issues-New-Regulation-on-AML-CFT-and-CPF-Program.aspx"},"Malaysia":{"code":"MY-BNM / MY-SSM","title":"Bank Negara Malaysia Customer Due Diligence + SSM BO framework","locus":"CDD, government-issued identity documents, beneficial ownership reporting and SSM company evidence","url":"https://amlcft.bnm.gov.my/customer-due-diligence"},"Australia":{"code":"AU-AMLCTF06 / AU-ASIC","title":"AUSTRAC Customer Due Diligence guidance + ASIC registry","locus":"CDD, beneficial ownership identification, risk-based UBO and registry-based legal-existence evidence","url":"https://www.austrac.gov.au/industry-and-business/obligations-and-guidance/your-amlctf-program/customer-due-diligence"},"New Zealand":{"code":"NZ-AMLCFT09 / NZ-DIA","title":"DIA AML/CFT guidance + NZ Companies Register","locus":"CDD, beneficial ownership identification, EDD triggers and registry-based legal-existence evidence","url":"https://www.dia.govt.nz/AML-CFT"},"India":{"code":"IN-PMLA / IN-RBI-MD-KYC / IN-CO-BEN","title":"Prevention of Money Laundering Act 2002 + RBI Master Direction KYC + Companies Act §90 SBO regime","locus":"CDD, OVD-based identity verification, Significant Beneficial Owner (Form BEN-2) regime and PMLA-aligned ownership evidence","url":"https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=11566"},"Lithuania":{"code":"LT-AMLLAW / EU-AMLD","title":"Lithuania AML Law + EU AMLD framework","locus":"CDD, beneficial ownership (JANGIS register) and EU AML directive obligations","url":"https://www.lb.lt/en/sfi-anti-money-laundering"},"Netherlands":{"code":"NL-WWFT / EU-AMLD","title":"Wet ter voorkoming van witwassen en financieren van terrorisme (Wwft) + EU AMLD framework","locus":"CDD, beneficial ownership (UBO register) and EU AML directive obligations","url":"https://www.dnb.nl/en/sector-information/integrity-supervision/legislation-and-regulations/anti-money-laundering-act-wwft/"},"China":{"code":"CN-PBOC-SAMR-BO / CN-AML","title":"PBOC/SAMR Measures for Administration of Beneficial Ownership Information + AML CDD requirements","locus":"CDD, beneficial ownership filing and market-entity registration evidence","url":"https://www.pbc.gov.cn/en/3688253/3689009/4180845/5372350/index.html"}}}

const ID_PROFILES = {
  "China": {
    preferred: ["PRC Resident Identity Card"],
    acceptable: ["Chinese passport", "Foreign Permanent Resident ID Card", "Foreign passport"],
    note: "For cross-border onboarding, passport is usually the safer first ask if the PRC Resident Identity Card cannot be independently verified or transliterated."
  },
  "Japan": {
    preferred: ["My Number Card", "Residence card for foreign residents", "Japanese passport"],
    acceptable: ["Foreign passport"],
    note: "For cross-border onboarding, passport is usually the safer first ask if the local My Number Card or residence card cannot be independently verified."
  },
  "Indonesia": {
    preferred: ["KTP / e-KTP for Indonesian residents"],
    acceptable: ["Passport for non-residents or fallback", "KITAS / KITAP as residency support"],
    note: "For Indonesia, KTP/e-KTP is the primary ID for residents. Passport is the primary standard for non-residents or where KTP cannot be verified. KITAS/KITAP supports residency status but should not replace the primary ID unless local policy accepts it."
  },
  "Malaysia": {
    preferred: ["MyKad", "MyPR for permanent residents"],
    acceptable: ["Passport", "MyKAS where applicable"],
    note: "For cross-border onboarding, passport is usually the safer first ask for non-residents or where the local card cannot be independently verified."
  },
  "USA": {
    preferred: ["U.S. passport", "State-issued driver's licence", "State-issued photo ID card"],
    acceptable: ["Foreign passport for non-U.S. persons"],
    note: "For cross-border onboarding, passport is usually the safer first ask; state-issued IDs work best where the person is U.S.-resident and the issuing authority is clear."
  },
  "Armenia": {
    preferred: ["Armenian national ID card"],
    acceptable: ["Passport", "Residence card for foreign residents"],
    note: "For cross-border onboarding, passport is usually the safer first ask where local ID verification is limited."
  },
  "Georgia": {
    preferred: ["Georgian national ID card", "Residence card for foreign residents"],
    acceptable: ["Passport"],
    note: "For cross-border onboarding, passport is often the safer first ask unless local e-verification is available."
  },
  "Kazakhstan": {
    preferred: ["Kazakh national ID card"],
    acceptable: ["Passport", "Residence permit for foreign residents"],
    note: "For cross-border onboarding, passport is usually the safer first ask where local ID verification is limited."
  },
  "Uzbekistan": {
    preferred: ["Uzbek ID card"],
    acceptable: ["Passport", "Residence permit for foreign residents"],
    note: "For cross-border onboarding, passport is usually the safer first ask where local ID verification is limited."
  },
  "Brazil": {
    preferred: ["RG (Registro Geral)", "CNH (Carteira Nacional de Habilitação)"],
    acceptable: ["Passport", "CRNM/RNM for foreign residents"],
    note: "CPF should be captured separately where tax ID is required; it is not a photo ID."
  },
  "Canada": {
    preferred: ["Canadian passport", "Provincial or territorial driver's licence", "Provincial or territorial photo ID card"],
    acceptable: ["Foreign passport"],
    note: "FINTRAC requires government-issued photo ID to be authentic, valid and current; municipal photo IDs are not acceptable."
  },
  "Hong Kong": {
    preferred: ["Hong Kong Identity Card (HKID)"],
    acceptable: ["Passport"],
    note: "HKID is the primary local photo ID for residents; passport is the safer ask for non-residents."
  },
  "Saudi Arabia": {
    preferred: ["Saudi National ID"],
    acceptable: ["Iqama (for residents)", "Passport"],
    note: "For cross-border onboarding, passport is usually the safer fallback for transliteration and travel-document checks."
  },
  "Singapore": {
    preferred: ["NRIC (citizen / PR)", "FIN card (foreign resident)"],
    acceptable: ["Passport"],
    note: "Passport is the safer ask for non-residents or where local electronic verification is unavailable."
  },
  "United Arab Emirates": {
    preferred: ["Emirates ID (nationals / residents)"],
    acceptable: ["Passport"],
    note: "Residence visa or permit can support residency status but should not replace the primary photo ID."
  },
  "United Kingdom": {
    preferred: ["Passport", "UK photocard driving licence"],
    acceptable: ["National identity card (where accepted)"],
    note: "For cross-border onboarding, passport is usually the clearest first ask."
  },
  "Australia": {
    preferred: ["Australian passport", "Australian driver's licence", "Photo Card"],
    acceptable: ["Foreign passport"],
    note: "AUSTRAC AML/CTF Rules require name + DOB + residential address verification. Use Document Verification Service (DVS) where available; passport is the safer ask for non-residents."
  },
  "New Zealand": {
    preferred: ["NZ passport", "NZ driver licence", "Kiwi Access Card"],
    acceptable: ["Foreign passport"],
    note: "DIA / AML/CFT Act 2009 requires reliable and independent identity verification. Passport is the safer first ask for non-residents."
  },
  "India": {
    preferred: ["Passport", "Aadhaar (with masked last 8 digits)", "Driving Licence"],
    acceptable: ["Voter ID", "PAN (supports tax ID, not solely a photo ID)"],
    note: "RBI Master Direction KYC accepts the OVD list (Officially Valid Documents). For cross-border onboarding, passport is the safer first ask. PAN is required where tax ID is mandatory."
  }
}

const ONBOARDING_ID_OVERLAYS = {
  "China": "China onboarding overlay: use PRC Resident Identity Card for resident PRC nationals where verifiable; passport is the safer first ask for non-residents or cross-border cases.",
  "Japan": "Japan onboarding overlay: use a valid government-issued photo ID. Passport is the safer first ask for non-residents and cross-border cases; My Number Card or residence card can support resident verification where reviewable.",
  "Indonesia": "Indonesia onboarding overlay: use KTP for resident Indonesians where verifiable; passport is the safer first ask for non-residents or cross-border cases.",
  "Malaysia": "Malaysia onboarding overlay: use MyKad/MyPR for Malaysian residents where verifiable; passport is the safer first ask for non-residents or cross-border cases.",
  "USA": "U.S. CIP-style practice: use a valid government-issued photo ID, with passport the safer first ask for non-U.S. persons or cross-border cases; for U.S. residents, a state-issued photo ID may be acceptable where it can be reliably reviewed.",
  "Singapore": "MAS-style practice: use resident local photo ID where reliable, but ask for passport for non-residents, cross-border cases, or where local ID cannot be independently verified.",
  "United Kingdom": "UK/JMLSG-style practice: passport is the safest first ask for cross-border onboarding; photocard driving licence works best for UK residents; national ID cards are more case-specific.",
  "Canada": "FINTRAC requires authentic, valid and current government-issued photo ID; if unavailable, use another prescribed method rather than accepting an unsupported local card.",
  "Hong Kong": "Use HKID for residents and passport for non-residents or cross-border cases.",
  "United Arab Emirates": "Use Emirates ID for residents and passport for non-residents; retain residency support where relevant.",
  "Brazil": "Use local national photo ID for residents and passport for non-residents or where cross-border verification is needed.",
  "Lithuania": "Use Lithuanian resident photo ID for residents and passport for non-residents or where cross-border verification is preferred.",
  "Netherlands": "Use Dutch resident photo ID for residents and passport for non-residents or where cross-border verification is preferred.",
  "Australia": "AUSTRAC overlay: identity verification must satisfy KYC Rule Chapter 4 (verify name, DOB, residential address from a reliable independent source). Use the Document Verification Service (DVS) where available; passport is the safer first ask for non-residents and cross-border cases.",
  "New Zealand": "DIA / AML-CFT Act 2009 overlay: identity verification must be reliable and independent. NZ resident photo ID for residents, passport for non-residents and cross-border cases.",
  "India": "RBI Master Direction KYC overlay: rely on the OVD list (passport, Aadhaar, driving licence, voter ID, NREGA, etc.). For cross-border, passport is the safer first ask. PAN is captured where required by tax law.",
  "Malta": "MFSA / Ixaris IFSM overlay: identity verification must satisfy Maltese AML/CFT obligations under the Prevention of Money Laundering Act and FIAU IPs. Passport is the safer first ask for non-residents."
}

const EU_COUNTRIES = ["Austria","Belgium","Bulgaria","Croatia","Cyprus","Czech Republic","Denmark","Estonia","Finland","France","Germany","Greece","Hungary","Ireland","Italy","Latvia","Lithuania","Luxembourg","Malta","Netherlands","Poland","Portugal","Romania","Slovakia","Slovenia","Spain","Sweden"];

const OPERATIONAL_COUNTRIES = ["Australia","Canada","Hong Kong","Indonesia","Japan","Malaysia","New Zealand","Singapore","United Kingdom","USA"];

const LIMITED_OPERATIONAL_COUNTRIES = ["India"];

const EEA_NON_EU = ["Iceland","Liechtenstein","Norway"];

const RESTRICTED_COUNTRIES = ["China","India","Japan","Malaysia","South Africa"];

const SCHEDULE_2_EXCEPTIONS = {
  US_CA_VIA_SG: (onboarding, incorp) => onboarding === "Singapore" && (incorp === "USA" || incorp === "Canada"),
  TRAVEL_VIA_UK: (onboarding, sector) => onboarding === "United Kingdom" && sector === "Marketplace / platform"
};

const CLIENT_TYPES = [
  "Individual",
  "Direct Client - Financial Institution",
  "Direct Client - Corporate",
  "Platform Client (corporate)",
  "End Customer (under Platform Client)",
  "Travel / OTA Client"
];

const PLATFORM_MODELS = [
  "N/A (not a Platform / End Customer)",
  "Embedded Platform",
  "Payments Platform"
];


// ─── Onboarding country derivation ───────────────────────────────────────────

/**
 * Derives the Nium onboarding/contracting entity from the client's country
 * of incorporation. This is the country whose licence and rule set applies.
 * 
 * Rule: if Nium is licensed in the incorp country → onboard there.
 * Otherwise → default to Singapore (MPI licence, broadest coverage).
 */
function deriveOnboardingCountry(incorporationCountry) {
  if (OPERATIONAL_COUNTRIES.includes(incorporationCountry)) {
    return incorporationCountry;
  }
  // EEA countries onboard via Lithuania (EU passport)
  if (EU_COUNTRIES.includes(incorporationCountry) || EEA_NON_EU.includes(incorporationCountry)) {
    return 'Lithuania';
  }
  return 'Singapore';
}

// ─── Entity type normalisation ────────────────────────────────────────────────

/**
 * Maps the agent's ownershipType values to the v26 entityType vocabulary.
 * The agent uses "Ownership Type" as the label; v26 calls it "Entity Type".
 * Extend this map as the agent's dropdown options evolve.
 */
function normaliseEntityType(ownershipType, entityType) {
  // entityType from Step 1 is already close to v26 vocab — use it directly
  // if it matches; otherwise try to map from ownershipType
  const v26Types = [
    'Individuals', 'Partnership/LLP', 'Privately owned',
    'Publicly listed', 'State-owned enterprise', 'Trust'
  ];
  if (v26Types.includes(entityType)) return entityType;

  const map = {
    'Public Listed Company': 'Publicly listed',
    'Publicly Listed':       'Publicly listed',
    'Private Limited':       'Privately owned',
    'Privately Owned':       'Privately owned',
    'Partnership':           'Partnership/LLP',
    'LLP':                   'Partnership/LLP',
    'Trust':                 'Trust',
    'SOE':                   'State-owned enterprise',
    'State Owned':           'State-owned enterprise',
    'Individual':            'Individuals',
    'Sole Trader':           'Individuals',
  };
  return map[ownershipType] || map[entityType] || 'Privately owned';
}

/**
 * Maps agent entityType (Financial Institution / Corporate) to a v26 sector
 * when no explicit sector is provided.  Conservative: returns the broadest
 * sector that won't suppress any documents.  Caller should pass real sector
 * when available (Step 4 recompute).
 */
function deriveSector(entityType, explicitSector) {
  if (explicitSector) return explicitSector;
  if (entityType === 'Financial Institution') return 'Financial Institution - EMI / PI / PSP / MSB';
  // Default — broadest non-FI bucket, no special suppressions
  return 'Other (General / non-regulated / commercial businesses)';
}

// ─── Core rule engine (ported from v26, DOM-free) ─────────────────────────────

function isLicensed(c){ return isOperational(c) || LIMITED_OPERATIONAL_COUNTRIES.includes(c); }

function isEEA(c){ return EU_COUNTRIES.includes(c) || EEA_NON_EU.includes(c); }

function isOperational(c){ return OPERATIONAL_COUNTRIES.includes(c) || isEEA(c); }

function isFISector(sector){ return sector === 'Bank / deposit-taking institution' || sector.startsWith('Financial Institution -'); }

function isPlatformSector(sector){ return sector === 'Marketplace / platform' || sector === 'Payments / EMI / remittance' || sector === 'Fintech - PSP / gateway / orchestration'; }

function isTravelScenario(sector){
  return sector === 'Travel / OTA / travel payments' || clientTypeIsTravelLike();
}

function clientTypeIsTravelLike(){
  const ct = '';
  return ct === 'Travel / OTA Client';
}

function clientTypeIsPlatformLike(){
  const ct = '';
  return ct === 'Platform Client (corporate)' || ct === 'End Customer (under Platform Client)';
}

function isIndonesiaRelevant(onboarding, incorp){ return onboarding === 'Indonesia' || incorp === 'Indonesia'; }

function uboThresholdText(country){
  if (country === 'Australia') return '25% or more ownership/control threshold — exact 25.00% must be captured.';
  if (country === 'New Zealand') return 'more than 25% ownership/control threshold — exact 25.00% is not captured by ownership threshold alone unless the person otherwise exercises effective control or Nium applies a stricter internal standard.';
  if (country === 'Indonesia') return '25% ownership/control threshold per Indonesia MLRO standard; trace through ownership layers to at least the second layer where 25% ownership exists, and continue further where effective control, opacity or risk assessment requires it.';
  if (country === 'Lithuania') return '25% ownership/control baseline, with 10% overlay where required by Lithuania/EU policy, EDD, or local MLRO direction.';
  return '25% ownership/control baseline, with 10% overlay where required by local policy, EDD, Lithuania/EU overlay, or MLRO direction.';
}

function uboFallbackText(country){
  return `Apply ${uboThresholdText(country)} Identify persons who otherwise exercise effective control even if the ownership threshold is not met. If no UBO can reasonably be identified after documented reasonable measures, apply the senior managing official fallback and record the rationale.`;
}

function getIdProfile(country){
  if (ID_PROFILES[country]) return ID_PROFILES[country];
  if (EU_COUNTRIES.includes(country)) {
    return {
      preferred: [`National ID card issued by ${country}`],
      acceptable: ["Passport", "Residence permit for foreign residents"],
      note: "For cross-border onboarding, passport is usually the safer first ask if the national ID cannot be independently verified or transliterated."
    };
  }
  const info = DATA.registry[country] || {};
  return {
    preferred: [info.id || "Government-issued photo ID"],
    acceptable: ["Passport"],
    note: "Use passport where the local ID type is not clearly verifiable in the onboarding workflow."
  };
}

function buildIdLocalEquivalent(country, onboarding, purpose){
  const p = getIdProfile(country);
  const label = purpose === 'UBO ID' ? 'For each identified UBO' : (purpose === 'Signatory ID' ? 'For each authorised signatory' : 'For the individual customer');
  const docTypes = []
    .concat(p.preferred || [])
    .concat(p.acceptable || [])
    .filter((v, i, a) => v && a.indexOf(v) === i);
  const pieces = [];
  if (docTypes.length) pieces.push(`Document types accepted may include: ${docTypes.join('; ')}.`);
  pieces.push('The exact document accepted may vary depending on residency status, onboarding channel, document verifiability, translation/transliteration quality, and local policy.');
  if (p.note) pieces.push(p.note);
  const overlay = ONBOARDING_ID_OVERLAYS[onboarding];
  if (overlay) pieces.push(`Onboarding-country overlay (${onboarding}): ${overlay}`);
  return `${label}. ${pieces.join(' ')}`;
}

function buildIdAnalystStep(country, onboarding, purpose){
  const p = getIdProfile(country);
  const who = purpose === 'UBO ID' ? 'each identified UBO' : (purpose === 'Signatory ID' ? 'each authorised signatory' : 'the individual customer');
  const docTypes = []
    .concat(p.preferred || [])
    .concat(p.acceptable || [])
    .filter((v, i, a) => v && a.indexOf(v) === i)
    .join('; ');
  let text = `Request and review an accepted government-issued identity document for ${who}. Document types may include: ${docTypes}. Confirm the document is valid, current, legible, independently reviewable where required, and that name, date of birth, nationality, document number and expiry match the onboarding file and screening results.`;
  const overlay = ONBOARDING_ID_OVERLAYS[onboarding];
  if (overlay) text += ` ${overlay}`;
  return text;
}

function addressLocalEquivalent(country, personType){
  const info = DATA.registry[country] || DATA.registry['United Kingdom'];
  const map = {
    'Saudi Arabia':'National address evidence / utility bill / bank statement / government correspondence',
    'United Arab Emirates':'Utility bill / bank statement / tenancy document / government correspondence',
    'Singapore':'Utility bill / bank statement / government letter',
    'Hong Kong':'Utility bill / bank statement / government correspondence',
    'Brazil':'Comprovante de residência / bank statement / government correspondence',
    'Canada':'Utility bill / bank statement / government correspondence / provincial letter',
    'China':'Household register / residence certificate / utility bill / bank statement / government correspondence',
    'Japan':'Residence certificate / utility bill / bank statement / government correspondence',
    'Indonesia':'Domicile letter / utility bill / bank statement / government correspondence',
    'Malaysia':'Utility bill / bank statement / government correspondence / tenancy agreement',
    'USA':'Utility bill / bank statement / government correspondence / lease / state or federal letter',
    'Australia':'Utility bill / bank statement / government correspondence / lease (must satisfy AUSTRAC reliable independent source test)',
    'New Zealand':'Utility bill / bank statement / government correspondence / lease',
    'India':'Aadhaar address / utility bill / passport / bank statement / RBI-prescribed proof of address (OVD)',
    'Iceland':'Utility bill / bank statement / national registration evidence',
    'Liechtenstein':'Utility bill / bank statement / residence registration evidence',
    'Norway':'Utility bill / bank statement / Folkeregister extract'
  };
  if (map[country]) return map[country];
  if (typeof EU_COUNTRIES !== 'undefined' && EU_COUNTRIES.includes(country)) {
    return 'Utility bill / bank statement / government correspondence / residence registration evidence';
  }
  return info.address || 'Utility bill / bank statement / government correspondence';
}

function addressAnalystStep(country, personType){
  const doc = addressLocalEquivalent(country, personType);
  const whoMap = {
    'director':'each relevant director',
    'ubo':'each identified UBO',
    'signatory':'each authorised signatory',
    'individual':'the individual customer'
  };
  const who = whoMap[personType] || 'the relevant person';
  return `Review the local equivalent (${doc}); confirm current residential address for ${who}, match it to the onboarding file, and resolve any inconsistency before activation.`;
}

function needsDirectorId(onboarding, entityType, sector){
  return entityType === 'Privately owned' || entityType === 'Partnership/LLP' || entityType === 'Fund' || entityType === 'Trust';
}

function needsDirectorAddress(onboarding, entityType, sector){
  return onboarding === 'Singapore' && (entityType === 'Privately owned' || entityType === 'Partnership/LLP');
}

function needsUboAddress(onboarding, entityType, sector){
  return entityType === 'Privately owned' || entityType === 'Partnership/LLP' || sector === 'Crypto / VASP / digital assets';
}

function needsSignatoryAddress(onboarding, entityType, sector){
  if (onboarding === 'United Kingdom') return false;
  return true;
}

function onboardingStandard(onboarding){
  const c = DATA.citations[onboarding] || DATA.citations['EU'];
  return {
    'Customer application form': {standard:'Signed customer application form', why:'Capture customer-provided onboarding representations, product request, declared purpose, and authorised applicant confirmation.', rule:c},
    'Purpose of account / relationship': {standard:'Purpose of account and intended relationship statement', why:'Capture the purpose and intended nature of the account, transaction, or business relationship, including product use, expected flows, corridors, counterparties and volumes.', rule:c},
    'Legal existence': {standard:'Official company registry extract', why:'Verify the entity exists, is active, and matches the onboarding application.', rule:c},
    'Constitution': {standard:'Constitutional document', why:'Confirm legal form, governance, powers, and any limitations on authority.', rule:c},
    'Ownership / control': {standard:'Ownership register / ownership chart', why:'Identify natural-person UBOs using the applicable jurisdictional ownership/control threshold and effective-control test, or apply the permitted senior managing official fallback after documented reasonable measures.', rule:c},
    'UBO ID': {standard:'Government-issued photo ID for each identified UBO', why:'Verify each identified beneficial owner identified under the applicable jurisdictional threshold or effective-control test.', rule:c},
    'Authority to act': {standard:'Board resolution / power of attorney / mandate', why:'Confirm the relationship and product are authorised and the named signatories may bind the customer.', rule:c},
    'Authorised signatories': {standard:'Authorised signatory list / mandate form', why:'Identify every natural person who will operate the relationship.', rule:c},
    'Signatory ID': {standard:'Government-issued photo ID for each authorised signatory', why:'Verify each signatory before the relationship is activated or the first permitted transaction occurs.', rule:c},
    'Regulatory status': {standard:'Regulatory licence / register evidence', why:'Confirm whether the customer is regulated and whether the proposed activity is permitted.', rule:c},
    'Business activity': {standard:'Business activity evidence', why:'Understand what the customer actually does and whether it matches the expected use case.', rule:c}
  };
}

function individualStandard(onboarding){
  const c = DATA.citations[onboarding] || DATA.citations['EU'];
  return {
    'Customer application form':{standard:'Signed customer application form', why:'Capture customer-provided onboarding representations, requested product, purpose and authorised applicant confirmation.', rule:c},
    'Purpose of account / relationship':{standard:'Purpose of account and intended relationship statement', why:'Capture the purpose and intended nature of the account, transaction, or business relationship.', rule:c},
    'Identity':{standard:'Government-issued photo ID', why:'Verify the customer’s identity.', rule:c},
    'Proof of address':{standard:'Proof of residential address', why:'Verify current residential address.', rule:c},
    'Tax ID':{standard:'Tax identification document / number evidence', why:'Capture tax identity where required for onboarding and screening.', rule:c},
    'Source of funds / occupation':{standard:'Source of funds / occupation evidence', why:'Understand how the customer is funded and whether the profile matches expected activity.', rule:c},
    'Purpose / expected activity':{standard:'Customer declaration / expected activity information', why:'Understand intended use of the account and expected transaction pattern.', rule:c}
  };
}

function selfSource(req, entityType, sector){
  const individualMode = entityType === 'Individuals' || sector === 'Individuals';
  if (individualMode) return ['Tax ID','Proof of address'].includes(req) ? 'Supplementary self-source' : 'Client-provided only';
  if (req === 'Legal existence') return 'Preferred self-source';
  if (req === 'Regulatory status') return 'Supplementary self-source';
  if (req === 'Ownership / control' && ['Publicly listed','State-owned enterprise'].includes(entityType)) return 'Supplementary self-source';
  if (req === 'Business activity') return 'Supplementary self-source';
  return 'Client-provided only';
}

function rfiRequired(req, entityType, sector){
  const individualMode = entityType === 'Individuals' || sector === 'Individuals';
  if (individualMode){
    if (['Identity','Proof of address','Source of funds / occupation','Purpose / expected activity'].includes(req)) return 'Required from client';
    return 'Request if self-source insufficient';
  }
  if (req === 'Legal existence') return 'Request if self-source insufficient';
  if (['Regulatory status','Business activity'].includes(req)) return 'Request if self-source insufficient';
  if (req === 'Ownership / control' && ['Publicly listed','State-owned enterprise'].includes(entityType)) return 'Request if self-source insufficient';
  return 'Required from client';
}

function notFeasible(req, entityType, sector, incorp){
  const country = incorp;
  if ((entityType === 'Publicly listed' || entityType === 'State-owned enterprise') && req === 'UBO ID'){
    return 'Not applicable by default. Capture the ownership fallback for the entity type and obtain senior management or control-person IDs where required.';
  }
  if (req === 'Ownership / control'){
    if (entityType === 'Publicly listed') return 'Use exchange filings, substantial shareholder notices and senior management. Do not chase UBO IDs by default.';
    if (entityType === 'State-owned enterprise') return 'Use official state ownership evidence, board list and senior management list. Do not chase UBO IDs by default.';
    if (entityType === 'Trust') return 'Document the rationale and identify trustees, settlor, protector and relevant beneficiaries instead of forcing an inapplicable shareholding analysis.';
    if (entityType === 'Fund') return 'Trace through the GP or manager structure and identify the relevant controlling persons instead of every passive investor.';
    if (entityType === 'Partnership/LLP') return uboFallbackText(country);
    if (sector === 'Bank / deposit-taking institution') return 'Use prudential supervision, ownership evidence sufficient to understand control, and senior management fallback where appropriate.';
    return 'Escalate to Compliance or MLRO if ownership cannot be traced to a reliable UBO or permitted fallback.';
  }
  if (req === 'UBO ID') return uboFallbackText(country) + ' Collect senior managing official ID where the fallback applies, subject to policy and MLRO sign-off.';
  if (req === 'Constitution') return 'Escalate. Constitutional evidence is core unless a documented local legal equivalent is accepted by Compliance.';
  if (req === 'Legal existence') return 'Escalate. Legal existence must be evidenced from an official source or certified client document.';
  if (['Authority to act','Authorised signatories','Signatory ID'].includes(req)) return 'Do not activate the relationship until authority and signatory identity are resolved.';
  if (req === 'Regulatory status') return 'Treat as unregulated until proven otherwise and escalate if the activity appears regulated.';
  return 'Escalate for Compliance review if the local equivalent is unavailable or inconsistent.';
}

function localEquivalent(country, req, entityType, sector, onboarding){
  const info = DATA.registry[country] || DATA.registry['United Kingdom'];
  // onboarding passed as param
  const individualMode = entityType === 'Individuals' || sector === 'Individuals';
  if (individualMode){
    const m = {
      'Customer application form':'Nium customer application form, signed by the individual customer or authorised representative',
      'Purpose of account / relationship':'Purpose of account declaration within the customer application form / onboarding questionnaire',
      'Identity': buildIdLocalEquivalent(country, onboarding, 'Identity'),
      'Proof of address': info.address,
      'Tax ID': info.tax,
      'Source of funds / occupation': 'Payslip / employment letter / tax return / bank statement',
      'Purpose / expected activity': 'Completed customer questionnaire / application form'
    };
    return m[req] || '';
  }
  if (entityType === 'Trust'){
    const m = {
      'Customer application form':'Nium customer application form, signed by trustee or authorised representative',
      'Purpose of account / relationship':'Purpose of account declaration within the customer application form / onboarding questionnaire',
      'Legal existence':'Trust Deed / certificate of trust where issued',
      'Constitution':'Trust Deed',
      'Ownership / control':'Trust Deed + settlor / trustee / protector / beneficiary schedule',
      'UBO ID':buildIdLocalEquivalent(country, onboarding, 'UBO ID'),
      'Authority to act':'Trustee resolution / authorised signatory mandate',
      'Authorised signatories':'Authorised signatory list / mandate form',
      'Signatory ID':buildIdLocalEquivalent(country, onboarding, 'Signatory ID'),
      'Regulatory status':'Trust licence / fiduciary registration if applicable',
      'Business activity':'Trust profile / purpose statement / source of wealth summary'
    };
    return m[req] || '';
  }
  if (entityType === 'Fund'){
    const m = {
      'Customer application form':'Nium customer application form, signed by GP, manager, trustee, responsible entity or authorised representative',
      'Purpose of account / relationship':'Purpose of account declaration within the customer application form / onboarding questionnaire + investment/fund-flow use case',
      'Legal existence':'Fund registry extract / certificate of formation',
      'Constitution':'LPA / partnership agreement / constitutional documents / offering memorandum',
      'Ownership / control':'Investor register + GP / manager ownership chain',
      'UBO ID':buildIdLocalEquivalent(country, onboarding, 'UBO ID'),
      'Authority to act':'Manager / GP resolution / authorised signatory mandate',
      'Authorised signatories':'Authorised signatory list / mandate form',
      'Signatory ID':buildIdLocalEquivalent(country, onboarding, 'Signatory ID'),
      'Regulatory status':'Fund / manager / adviser licence or register evidence if applicable',
      'Business activity':'Offering memorandum / fact sheet / investment strategy summary'
    };
    return m[req] || '';
  }
  if (entityType === 'Partnership/LLP'){
    const m = {
      'Customer application form':'Nium customer application form, signed by partner/member or authorised representative',
      'Purpose of account / relationship':'Purpose of account declaration within the customer application form / onboarding questionnaire',
      'Legal existence': info.legal,
      'Constitution':'Partnership agreement / LLP agreement',
      'Ownership / control':'Partners / members register + ownership chart',
      'UBO ID':buildIdLocalEquivalent(country, onboarding, 'UBO ID'),
      'Authority to act':'Partner resolution / authorised signatory mandate / power of attorney',
      'Authorised signatories':'Authorised signatory list / mandate form',
      'Signatory ID':buildIdLocalEquivalent(country, onboarding, 'Signatory ID'),
      'Regulatory status':'Professional / regulatory registration if applicable',
      'Business activity':'Website / invoices / service agreements / management accounts'
    };
    return m[req] || '';
  }
  const m = {
    'Customer application form':'Nium customer application form, signed by an authorised director, officer, trustee, partner, authorised signatory or person with delegated authority',
    'Purpose of account / relationship':'Purpose of account declaration within the customer application form / onboarding questionnaire + expected use-case details',
    'Legal existence': info.legal,
    'Constitution': info.constitution,
    'Ownership / control': (entityType === 'Publicly listed' ? 'Exchange filings + substantial shareholder notices + ownership chart' : (entityType === 'State-owned enterprise' ? 'Official state ownership evidence + board / senior management list' : info.ownership)),
    'UBO ID':buildIdLocalEquivalent(country, onboarding, 'UBO ID'),
    'Authority to act':'Board resolution / power of attorney / authorised mandate',
    'Authorised signatories':'Authorised signatory list / board-certified mandate',
    'Signatory ID':buildIdLocalEquivalent(country, onboarding, 'Signatory ID'),
    'Regulatory status':'Regulator register entry / licence / authorisation',
    'Business activity':'Website / invoices / contracts / management accounts / pitch deck'
  };
  return m[req] || '';
}

function analystStep(req, localDoc, entityType, sector, incorp, onboarding){
  const individualMode = entityType === 'Individuals' || sector === 'Individuals';
  const country = incorp || 'United Kingdom';
  
  if (individualMode){
    const m = {
      'Customer application form':'Confirm the customer application form is complete and signed by the individual customer or authorised representative; resolve inconsistencies before activation.',
      'Purpose of account / relationship':'Review stated purpose and intended nature of the relationship; document products requested, expected transaction types, corridors, counterparties, volumes and source of funds/funding route.',
      'Identity':buildIdAnalystStep(country, onboarding, 'Identity'),
      'Proof of address':`Review the local equivalent (${localDoc}); confirm the residential address is current and matches the onboarding file.`,
      'Tax ID':`Review the local equivalent (${localDoc}); record the number in the file and resolve any mismatch with the customer profile.`,
      'Source of funds / occupation':`Review the local equivalent (${localDoc}); confirm the stated occupation and funding source are plausible for expected activity.`,
      'Purpose / expected activity':`Review the local equivalent (${localDoc}); document the expected use case, volumes and geographies in the onboarding notes.`
    };
    return m[req] || '';
  }
  const m = {
    'Customer application form':'Confirm the customer application form is complete and signed by an authorised director, officer, trustee, partner, authorised signatory or person with delegated authority. If authority is not independently verifiable, request mandate / board resolution / POA.',
    'Purpose of account / relationship':'Review and document the purpose and intended nature of the account, transaction or business relationship, including requested products, expected transaction types, volumes, corridors, counterparties and whether activity is own-account, client-money, payroll, vendor payments, platform settlement, travel payments or treasury.',
    'Legal existence':`Review the local equivalent (${localDoc}); match legal name, registration number, status, incorporation date and registered address to the application.`,
    'Constitution':`Review the local equivalent (${localDoc}); confirm legal form, governance, powers and any execution or signing limitations.`,
    'Ownership / control':`Review the local equivalent (${localDoc}); map ownership or control to the natural person UBOs or the permitted fallback and reconcile any mismatch with public filings.`,
    'UBO ID':buildIdAnalystStep(country, onboarding, 'UBO ID'),
    'Authority to act':`Review the local equivalent (${localDoc}); confirm it expressly covers the relationship, product and named signatories.`,
    'Authorised signatories':`Review the local equivalent (${localDoc}); list every person permitted to act and match them to the signing or operational instructions.`,
    'Signatory ID':buildIdAnalystStep(country, onboarding, 'Signatory ID'),
    'Regulatory status':`Review the local equivalent (${localDoc}); confirm the entity is regulated where required and that the licence scope matches the proposed activity.`,
    'Business activity':`Review the local equivalent (${localDoc}); document what the customer actually does, how funds flow and whether the proposed use case is consistent.`
  };
  return m[req] || '';
}

function applyIndonesiaMlroOverlay(rows, onboarding, incorp, entityType, sector){
  if (!isIndonesiaRelevant(onboarding, incorp)) return rows;
  const ref = DATA.citations[onboarding] || DATA.citations['EU'];
  const individualMode = entityType === 'Individuals' || sector === 'Individuals';

  rows = rows.filter(r => !['Director proof of address','UBO proof of address','Signatory proof of address'].includes(r.requirement));

  rows.forEach(r => {
    if (r.requirement === 'Legal existence') {
      r.localEquivalent = 'Deed of Establishment + latest Deed(s) of Amendment + MOLHR/MLOHR approval decree (SK Kemenkumham) + NIB + AHU company profile + company NPWP';
      r.analystStep = 'Collect and review the complete Indonesia legal entity document set: Deed of Establishment, latest amendments, relevant MOLHR/MLOHR decree, NIB, AHU profile and company NPWP. Match name, NIB/registration details, NPWP, address and status to the application.';
      r.selfSource = 'Supplementary self-source'; r.rfi = 'Required from client';
    }
    if (r.requirement === 'Constitution') {
      r.localEquivalent = 'Deed of Establishment and latest Deed(s) of Amendment / Articles of Association, together with relevant MOLHR/MLOHR decree';
      r.analystStep = 'Review deed(s), Articles and MOLHR/MLOHR decree to confirm legal form, governance, powers and authority limitations.';
      r.selfSource = 'Client-provided only'; r.rfi = 'Required from client';
    }
    if (r.requirement === 'Ownership / control') {
      r.localEquivalent = 'Shareholder register + ownership chart tracing through ownership layers to at least the second layer where a 25% ownership/control interest exists';
      r.analystStep = 'Apply Indonesia 25% ownership/control threshold. Trace ownership through at least the second layer where a 25% ownership/control interest exists, and continue further if control, opacity, sanctions/PEP exposure or risk assessment requires it.';
      r.fallback = 'If no natural-person UBO can reasonably be identified after documented look-through and effective-control checks, obtain a signed director UBO declaration and identify the senior managing official / controlling officer fallback.';
      r.selfSource = 'Client-provided only'; r.rfi = 'Required from client';
    }
    if (r.requirement === 'UBO ID') {
      r.localEquivalent = 'KTP / e-KTP for Indonesian resident UBOs; passport for non-resident UBOs or fallback; KITAS/KITAP as residency support';
      r.analystStep = 'Verify each UBO identified under the Indonesia 25% ownership/control threshold or effective-control test. Use KTP/e-KTP for residents and passport for non-residents/fallback; KITAS/KITAP may support residency.';
      r.fallback = 'If no natural-person UBO can reasonably be identified after documented look-through and effective-control checks, obtain a signed director UBO declaration and collect senior managing official / controlling officer ID where required.';
      r.selfSource = 'Client-provided only'; r.rfi = 'Required from client';
    }
    if (r.requirement === 'Director ID') {
      r.localEquivalent = 'KTP / e-KTP for Indonesian resident directors; passport for non-resident directors or fallback; KITAS/KITAP as residency support';
      r.analystStep = 'Verify director identity using KTP/e-KTP for residents or passport for non-residents/fallback. Do not request separate proof of address by default where valid KTP/e-KTP is collected unless risk assessment or policy requires it.';
      r.selfSource = 'Client-provided only'; r.rfi = 'Required from client';
    }
    if (r.requirement === 'Signatory ID') {
      r.localEquivalent = 'KTP / e-KTP for Indonesian resident signatories; passport for non-resident signatories or fallback; KITAS/KITAP as residency support';
      r.analystStep = 'Verify signatory identity using KTP/e-KTP for residents or passport for non-residents/fallback. Do not request separate proof of address by default where valid KTP/e-KTP is collected unless risk assessment or policy requires it.';
      r.selfSource = 'Client-provided only'; r.rfi = 'Required from client';
    }
    if (r.requirement === 'Proof of address') {
      r.localEquivalent = individualMode ? 'KTP/e-KTP address for Indonesian residents; separate address evidence only for non-residents, passport-only cases, mismatch or risk-based trigger' : 'Entity address evidence where operational address differs from AHU / NIB / legal documents';
      r.analystStep = individualMode ? 'Use address captured in valid KTP/e-KTP for Indonesian residents. Request separate proof of address only if the person is non-resident, uses passport only, address is inconsistent, or risk assessment/policy requires it.' : 'Obtain entity address evidence only where the operational or registered address differs from AHU, NIB or legal documents.';
      r.selfSource = 'Supplementary self-source'; r.rfi = 'Request if self-source insufficient';
    }
  });

  if (!individualMode && !rows.some(r => r.requirement === 'Indonesia entity address evidence')) {
    const idx = rows.findIndex(r => r.requirement === 'Legal existence');
    rows.splice(idx >= 0 ? idx + 1 : rows.length, 0, {
      requirement:'Indonesia entity address evidence',
      standard:'Entity operational / registered address evidence where different from legal documents',
      localEquivalent:'NIB / AHU address plus domicile letter, lease, utility bill, bank statement or other business address evidence where operational/registered address differs from legal documents',
      why:'Confirm the operating or registered address where it differs from AHU, NIB or other legal documents.',
      analystStep:'Compare the application address against AHU, NIB and deeds. Request business address evidence only where the operational/registered address differs or cannot be validated from legal documents.',
      fallback:'Escalate if the operational address is material to risk assessment and cannot be validated.',
      selfSource:'Supplementary self-source',
      rfi:'Request if self-source insufficient',
      ruleCode:ref.code, ruleLocus:ref.locus, ruleTitle:ref.title, ruleUrl:ref.url,
      sourceUrl:DATA.registry['Indonesia'] ? DATA.registry['Indonesia'].url : DATA.registry[incorp].url
    });
  }
  return rows;
}

function applyUkSignatoryAuthorityOverlay(rows, onboarding, incorp){
  const isUkRelevant = onboarding === 'United Kingdom' || incorp === 'United Kingdom';
  if (!isUkRelevant) return rows;

  // Do not require signatory proof of address automatically for UK.
  // UK MLRO requirement is authority evidence on a risk-based basis, not blanket residential address collection.
  rows = rows.filter(r => r.requirement !== 'Signatory proof of address');

  if (!rows.some(r => r.requirement === 'UK signatory authority evidence')) {
    const ref = DATA.citations[onboarding] || DATA.citations['EU'];
    const signatoryIdIndex = rows.findIndex(r => r.requirement === 'Signatory ID');
    const authorityIndex = rows.findIndex(r => r.requirement === 'Authority to act');
    const insertAt = signatoryIdIndex >= 0 ? signatoryIdIndex + 1 : (authorityIndex >= 0 ? authorityIndex + 1 : rows.length);

    rows.splice(insertAt, 0, {
      requirement:'UK signatory authority evidence',
      standard:'Companies House officer check; if authority is unclear, obtain board resolution, mandate, delegated authority letter or POA',
      localEquivalent:'Companies House officer/director record + board resolution / authorised signatory mandate / delegated authority letter / Power of Attorney where signatory authority is not independently verifiable',
      why:'Confirm that each UK signatory has authority to bind the customer and operate the relationship on a risk-based basis.',
      analystStep:'First self-source Companies House to check whether the signatory is an officer/director. If the signatory is not listed, authority is unclear, the product/use case is higher risk, or the person signs under delegation, request board resolution, mandate, delegated authority letter or POA before activation.',
      fallback:'Do not activate the relationship if signatory authority cannot be independently verified or supported by mandate, board resolution, delegated authority letter or POA.',
      selfSource:'Supplementary self-source',
      rfi:'Request if self-source insufficient',
      ruleCode:ref.code,
      ruleLocus:ref.locus,
      ruleTitle:ref.title,
      ruleUrl:ref.url,
      sourceUrl:(DATA.registry['United Kingdom'] || DATA.registry[incorp]).url
    });
  }
  return rows;
}

function buildRows(onboarding, incorp, entityType, sector){
  const individualMode = entityType === 'Individuals' || sector === 'Individuals';

  const base = individualMode ? individualStandard(onboarding) : onboardingStandard(onboarding);
  let requirements = Object.keys(base);

  // PR-044: 'Authority to act' is no longer requested on the Required Documents
  // page. It now lives only on the Applicant page, shown when the applicant
  // declares they are not a listed director/officer ("I am not listed"), so it
  // is never asked for twice. Removed at the checklist source, not at render.
  requirements = requirements.filter(r => r !== 'Authority to act');

  if (!individualMode){
    if (['Publicly listed','State-owned enterprise'].includes(entityType)) requirements = requirements.filter(r => r !== 'UBO ID');
    if (sector === 'Bank / deposit-taking institution' && entityType !== 'Privately owned' && entityType !== 'Partnership/LLP') requirements = requirements.filter(r => r !== 'UBO ID');
    if (sector === 'Crypto / VASP / digital assets' && !requirements.includes('UBO ID')) requirements.splice(3, 0, 'UBO ID');
  }

  let rows = requirements.map(req => {
    const localDoc = localEquivalent(incorp, req, entityType, sector, onboarding);
    const ref = base[req].rule;
    return {
      requirement:req,
      standard:base[req].standard,
      localEquivalent:localDoc,
      why:base[req].why,
      analystStep:analystStep(req, localDoc, entityType, sector, incorp, onboarding),
      fallback:notFeasible(req, entityType, sector, incorp),
      selfSource:selfSource(req, entityType, sector),
      rfi:rfiRequired(req, entityType, sector),
      ruleCode:ref.code,
      ruleLocus:ref.locus,
      ruleTitle:ref.title,
      ruleUrl:ref.url,
      sourceUrl:DATA.registry[incorp].url
    };
  });


  rows.forEach(r => {
    if (incorp === 'United Kingdom' && r.requirement === 'Constitution') {
      r.localEquivalent = 'Companies House filing history: Memorandum and Articles of Association / Articles of Association';
      r.analystStep = 'Self-source the Memorandum and Articles / Articles from Companies House filing history where available. Request from the client only if the filing is unavailable, illegible, outdated, inconsistent, or the entity is not fully covered by Companies House.';
      r.selfSource = 'Preferred self-source';
      r.rfi = 'Request if self-source insufficient';
    }
    if (incorp === 'United Kingdom' && r.requirement === 'Ownership / control' && false) {
      r.analystStep = 'For UK underlying platform customers, self-source ownership/control using Orbis and Companies House PSC / filings where available; request client documents only where self-source is insufficient, stale, inconsistent, layered, or non-UK.';
      r.selfSource = 'Supplementary self-source';
      r.rfi = 'Request if self-source insufficient';
    }
  });


  function addUkSignatoryAuthorityEvidence(){
    if (!(onboarding === 'United Kingdom' || incorp === 'United Kingdom')) return;
    if (rows.some(r => r.requirement === 'UK signatory authority evidence')) return;
    const ref = DATA.citations[onboarding] || DATA.citations['EU'];
    const signatoryIndex = rows.findIndex(r => r.requirement === 'Signatory ID');
    const insertAt = signatoryIndex >= 0 ? signatoryIndex + 1 : rows.length;
    rows.splice(insertAt, 0, {
      requirement:'UK signatory authority evidence',
      standard:'Companies House officer check; if authority is unclear, obtain board resolution, mandate, delegated authority letter or POA',
      localEquivalent:'Companies House officer/director record + board resolution / authorised signatory mandate / delegated authority letter / Power of Attorney where signatory authority is not independently verifiable',
      why:'Confirm that each UK signatory has authority to bind the customer and operate the relationship on a risk-based basis.',
      analystStep:'First self-source Companies House to check whether the signatory is an officer/director. If the signatory is not listed, authority is unclear, the product/use case is higher risk, or the person signs under delegation, request board resolution, mandate, delegated authority letter or POA before activation.',
      fallback:'Do not activate the relationship if signatory authority cannot be independently verified or supported by mandate, board resolution, delegated authority letter or POA.',
      selfSource:'Supplementary self-source',
      rfi:'Request if self-source insufficient',
      ruleCode:ref.code,
      ruleLocus:ref.locus,
      ruleTitle:ref.title,
      ruleUrl:ref.url,
      sourceUrl:(DATA.registry['United Kingdom'] || DATA.registry[incorp]).url
    });
  }


  rows.forEach(r => {
    if (r.requirement === 'Ownership / control') {
      r.analystStep = r.analystStep + ' Apply UBO threshold: ' + uboThresholdText(incorp);
      r.fallback = uboFallbackText(incorp);
    }
    if (r.requirement === 'UBO ID') {
      r.analystStep = r.analystStep + ' Verify only those UBOs identified under the applicable threshold/effective-control test. ' + uboThresholdText(incorp);
      r.fallback = uboFallbackText(incorp) + ' Collect senior managing official ID where fallback applies.';
    }
  });

  if (!individualMode) {
    const ref = DATA.citations[onboarding] || DATA.citations['EU'];

    if (needsDirectorId(onboarding, entityType, sector)) {
      rows.splice(Math.min(rows.length, 4), 0, {
        requirement:'Director ID',
        standard:'Government-issued photo ID for each relevant director',
        localEquivalent:buildIdLocalEquivalent(incorp, onboarding, 'Signatory ID'),
        why:'Identify and verify directors relevant to authority, control, or fallback ownership analysis.',
        analystStep:buildIdAnalystStep(incorp, onboarding, 'Signatory ID'),
        fallback:'If a director is not relevant to authority, control, or fallback ownership analysis, document the rationale for not collecting the ID.',
        selfSource:'Client-provided only',
        rfi:'Required from client',
        ruleCode:ref.code,
        ruleLocus:ref.locus,
        ruleTitle:ref.title,
        ruleUrl:ref.url,
        sourceUrl:DATA.registry[incorp].url
      });
    }

    if (needsDirectorAddress(onboarding, entityType, sector)) {
      rows.splice(Math.min(rows.length, 5), 0, {
        requirement:'Director proof of address',
        standard:'Proof of residential address for each relevant director',
        localEquivalent:addressLocalEquivalent(incorp, 'director'),
        why:'Support person-level verification where directors are material to authority, control, or fallback ownership analysis.',
        analystStep:addressAnalystStep(incorp, 'director'),
        fallback:'If the director is not material to authority, control, or fallback ownership analysis, document the rationale and do not collect this item.',
        selfSource:'Client-provided only',
        rfi:'Required from client',
        ruleCode:ref.code,
        ruleLocus:ref.locus,
        ruleTitle:ref.title,
        ruleUrl:ref.url,
        sourceUrl:DATA.registry[incorp].url
      });
    }

    if (rows.some(r => r.requirement === 'UBO ID') && needsUboAddress(onboarding, entityType, sector)) {
      const uboIdx = rows.findIndex(r => r.requirement === 'UBO ID');
      rows.splice(uboIdx + 1, 0, {
        requirement:'UBO proof of address',
        standard:'Proof of residential address for each identified UBO',
        localEquivalent:addressLocalEquivalent(incorp, 'ubo'),
        why:'Support person-level verification of each identified beneficial owner.',
        analystStep:addressAnalystStep(incorp, 'ubo'),
        fallback:'If no natural-person UBO can reasonably be identified after documented reasonable measures using the applicable jurisdictional ownership/control threshold, record the rationale and apply the senior managing official fallback.',
        selfSource:'Client-provided only',
        rfi:'Required from client',
        ruleCode:ref.code,
        ruleLocus:ref.locus,
        ruleTitle:ref.title,
        ruleUrl:ref.url,
        sourceUrl:DATA.registry[incorp].url
      });
    }

    const sigIdx = rows.findIndex(r => r.requirement === 'Signatory ID');
    if (sigIdx >= 0 && needsSignatoryAddress(onboarding, entityType, sector)) {
      rows.splice(sigIdx + 1, 0, {
        requirement:'Signatory proof of address',
        standard:'Proof of residential address for each authorised signatory',
        localEquivalent:addressLocalEquivalent(incorp, 'signatory'),
        why:'Support person-level verification for each authorised signatory.',
        analystStep:addressAnalystStep(incorp, 'signatory'),
        fallback:'Do not activate the relationship until signatory identity and address checks are resolved or formally waived under policy.',
        selfSource:'Client-provided only',
        rfi:'Required from client',
        ruleCode:ref.code,
        ruleLocus:ref.locus,
        ruleTitle:ref.title,
        ruleUrl:ref.url,
        sourceUrl:DATA.registry[incorp].url
      });
    }
  }

  rows = applyIndonesiaMlroOverlay(rows, onboarding, incorp, entityType, sector);
  rows = applyUkSignatoryAuthorityOverlay(rows, onboarding, incorp);
  return rows;
}


// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Main entry point.
 * 
 * @param {object} params
 * @param {string} params.incorporationCountry  - Country where client is registered
 * @param {string} [params.onboardingCountry]   - Nium contracting entity country (derived if omitted)
 * @param {string} params.entityType            - Agent entity type ('Financial Institution' | 'Corporate' | ...)
 * @param {string} params.ownershipType         - Agent ownership type ('Public Listed Company' | 'Privately owned' | ...)
 * @param {string} [params.sector]              - v26 sector string (optional at Step 1, send at Step 4)
 * @returns {ChecklistItem[]}
 */
function getRequirements({
  incorporationCountry,
  onboardingCountry,
  entityType,
  ownershipType,
  sector,
}) {
  const resolvedOnboarding = onboardingCountry || deriveOnboardingCountry(incorporationCountry);
  const resolvedEntityType = normaliseEntityType(ownershipType, entityType);
  const resolvedSector     = deriveSector(entityType, sector);

  const rows = buildRows(resolvedOnboarding, incorporationCountry, resolvedEntityType, resolvedSector);

  return rows.map(r => ({
    requirement:          r.requirement,
    standardDocument:     r.standard,
    localEquivalent:      r.localEquivalent,
    why:                  r.why,
    analystStep:          r.analystStep,
    fallback:             r.fallback,
    selfSource:           r.selfSource,           // 'Preferred self-source' | 'Supplementary self-source' | 'Client-provided only'
    rfi:                  r.rfi,                  // 'Required from client' | 'Request if self-source insufficient'
    mandatory:            r.rfi === 'Required from client',
    regulatoryRationale:  r.ruleTitle || '',
    regulatoryUrl:        r.ruleUrl   || '',
    sourceUrl:            r.sourceUrl || '',
  }));
}

/**
 * Delta helper — call at pre-declaration recompute.
 * Returns only the mandatory items not yet covered by submitted docs.
 * 
 * @param {object}   params          - same as getRequirements
 * @param {string[]} submittedKeys   - array of requirement names already submitted
 * @returns {ChecklistItem[]}        - mandatory gaps only
 */
function getMandatoryGaps(params, submittedKeys = []) {
  const all = getRequirements(params);
  return all.filter(item => item.mandatory && !submittedKeys.includes(item.requirement));
}

// CommonJS exports — required directly by api/document-requirements.js and
// src/setupProxy.js (local dev). Frontend never imports this module; it reaches
// the engine over HTTP via the /api/document-requirements route.
module.exports = {
  getRequirements,
  getMandatoryGaps,
  deriveOnboardingCountry,
  normaliseEntityType,
  deriveSector,
};
