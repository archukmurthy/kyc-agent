var AuthorityBaseValidator =
  typeof require === "function"
    ? require("./BaseValidator")
    : window.ValidationBaseValidator;

class AuthorityValidator extends AuthorityBaseValidator {
  constructor(options = {}) {
    super({ ruleId: "LOA.AUTHORITY.VALID", name: "AuthorityValidator", ...options });
  }
}

if (typeof module !== "undefined") module.exports = AuthorityValidator;
if (typeof window !== "undefined") window.AuthorityValidator = AuthorityValidator;
