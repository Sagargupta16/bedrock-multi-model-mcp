import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthError, withBearerFallback } from "./client.js";

function sdkError(name: string, message = name): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

test("isAuthError accepts rejections that happen before Bedrock runs the request", () => {
  for (const name of [
    "CredentialsProviderError",
    "UnrecognizedClientException",
    "InvalidSignatureException",
    "ExpiredTokenException",
    "AccessDeniedException",
  ]) {
    assert.equal(isAuthError(sdkError(name)), true, name);
  }
});

test("isAuthError rejects errors where the request may already have run", () => {
  for (const name of [
    "ThrottlingException",
    "ModelTimeoutException",
    "ServiceUnavailableException",
    "InternalServerException",
    "ValidationException",
    "TimeoutError",
  ]) {
    assert.equal(isAuthError(sdkError(name)), false, name);
  }
  assert.equal(isAuthError("CredentialsProviderError"), false, "a bare string is not an Error");
});

test("withBearerFallback returns the SDK result without calling HTTP", async () => {
  let httpCalls = 0;
  const out = await withBearerFallback(
    async () => "sdk",
    async () => {
      httpCalls++;
      return "http";
    },
    "token",
  );
  assert.equal(out, "sdk");
  assert.equal(httpCalls, 0);
});

test("withBearerFallback retries over HTTP once on an auth error", async () => {
  let httpCalls = 0;
  const out = await withBearerFallback(
    async () => {
      throw sdkError("CredentialsProviderError", "Could not load credentials from any providers");
    },
    async () => {
      httpCalls++;
      return "http";
    },
    "token",
  );
  assert.equal(out, "http");
  assert.equal(httpCalls, 1);
});

test("withBearerFallback never retries a throttle or timeout (no duplicate billed job)", async () => {
  for (const name of ["ThrottlingException", "TimeoutError", "InternalServerException"]) {
    let httpCalls = 0;
    await assert.rejects(
      withBearerFallback(
        async () => {
          throw sdkError(name);
        },
        async () => {
          httpCalls++;
          return "http";
        },
        "token",
      ),
      { name },
    );
    assert.equal(httpCalls, 0, name);
  }
});

test("withBearerFallback rethrows the SDK error untouched when no token is set", async () => {
  const original = sdkError("CredentialsProviderError");
  await assert.rejects(
    withBearerFallback(
      async () => {
        throw original;
      },
      async () => "http",
      undefined,
    ),
    (err) => err === original,
  );
});

test("withBearerFallback keeps the SDK error when the HTTP retry fails too", async () => {
  const original = sdkError("ExpiredTokenException", "The security token included in the request is expired");
  await assert.rejects(
    withBearerFallback(
      async () => {
        throw original;
      },
      async () => {
        throw new Error("Bedrock API error (403): Forbidden");
      },
      "token",
    ),
    (err: Error) => {
      assert.match(err.message, /Bedrock API error \(403\)/);
      assert.match(err.message, /after SDK ExpiredTokenException: The security token/);
      assert.equal(err.cause, original);
      return true;
    },
  );
});
