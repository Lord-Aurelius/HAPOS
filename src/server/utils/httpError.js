"use strict";

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = "BAD_REQUEST";
  return err;
}

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  err.code = "FORBIDDEN";
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  err.code = "NOT_FOUND";
  return err;
}

module.exports = { badRequest, forbidden, notFound };
