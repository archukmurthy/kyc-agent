"use strict";

const fs = require("fs");
const path = require("path");

function fixture(provider, name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", provider, name), "utf8"));
}

class QueueHttpClient {
  constructor(responses = []) {
    this.responses = [...responses];
    this.requests = [];
  }

  async request(input) {
    this.requests.push(input);
    if (!this.responses.length) throw new Error("Unexpected provider HTTP request");
    const response = this.responses.shift();
    return typeof response === "function" ? response(input) : response;
  }
}

function response(data, headers = {}) {
  const rawBody = JSON.stringify(data);
  return {
    data,
    rawBody,
    statusCode: 200,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
  };
}

module.exports = { fixture, QueueHttpClient, response };
