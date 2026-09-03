# UBO Control policy catalogue

| Policy | Schema | Status | Canonical hash | Current use |
|---|---:|---|---|---|
| UK Corporate 1.3-RC | 1.0 | Historical | `sha256:6bb687ae0c65de7063473db7d34c4f693279dafdd7ef293c79d22347aab29496` | Historical tests and reconstruction |
| UK Corporate 1.4-RC | 1.1 | Historical | `sha256:43e1ce72f884d626a4962351a44c7305117c6b12d6e398ca1ebb4ca46813a87a` | Historical tests and reconstruction |
| UK Corporate 1.5-RC | 1.2 | `CONTROL_ROOM_REVIEW` | `sha256:724c2fa4820e02daddc24e652b50748646d87017cbfa632c062bc9e27de4b790` | Current Decision Application/Lab characterization baseline |
| UK Corporate 1.6-RC | 1.3 | `CONTROL_ROOM_REVIEW` | `sha256:6f4235ca32b961868f294b862810d101516a35a5ce8fe8a031ec2d2166e6e969` | Data inspection, schema validation, canonical hashing and readiness assessment only |

UK Corporate 1.6-RC is not effective, has no approver, is not selected by current composition and is not production-ready. Its readiness is `REVIEW_ONLY` in LAB and `BLOCKED` in PRODUCTION. See its [source mapping](../../policies/uk-corporate/1.6-rc/SOURCE_MAPPING.md) and [assertion plan](../../policies/uk-corporate/1.6-rc/test-assertion-plan.json).
