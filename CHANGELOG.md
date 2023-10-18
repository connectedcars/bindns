# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this
project adheres to [Semantic Versioning](http://semver.org/).

(Unreleased)
==================
### Changed
* **SEMVER MAJOR** The client request callback is now invoked with an error as
  the first argument: `(err: Error|null, res: ClientResponse)`.
* Performance improvements.
* Improve JSDoc annotations.
* Make the query class for client requests optional, and default to `IN`.
### Added
* **SEMVER MAJOR** Add timeout option to ClientRequests ([#5](https://github.com/primitybio/bindns/issues/5)).
  This changes the default from no timeout to 10 seconds. Timeouts are indicated
  by an error passed as the first argument to the request callback, or by
  emitting an "error" event if there is no callback.
* Add simple client request example (examples/simple-client.js).
* Add `getRcodeError` convenience function to translate RCODEs to readable error
  messages.
### Fixed
* Fix error in `ns_name_ntop` ([#4](https://github.com/primitybio/bindns/issues/4)).
* Fix occasional hang ([#1](https://github.com/primitybio/bindns/issues/5)).
* Use sequential request IDs to reduce risk of collision.

Inception
==================

See the **History** section of the README.
