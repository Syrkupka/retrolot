// Помилка бізнес-логіки. Нічого не знає про HTTP; lib/http.js перетворює `code` на HTTP-статус.
class DomainError extends Error {
  constructor(code, detail, extra) {
    super(detail || code);
    this.code = code;
    this.extra = extra;
  }
}

const fail = (code, detail, extra) => { throw new DomainError(code, detail, extra); };

module.exports = { DomainError, fail };
