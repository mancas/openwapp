// mozContacts polyfill!
// https://developer.mozilla.org/es/docs/Web/API/ContactManager

// I have to define the service protocol, and this is as good place as any. The
// protocol will be as follows:
// * Each request will have a numeric request id, set by the client
// * The answers will include the request id, so the client can know to which
//   request the answer corresponds

// For all the operations over a DeviceStorage object:
//  * Request: { id: requestId,
//               data: {
//                 operation: methodName,
//                 params: params
//               }
//             }
// * Answer: { id: requestId,
//             result|error: Whatever }

// For the oncontactchange operation
//  Request: { id: requestId,
//             data: {
//             operation: 'oncontactchange'
//           },
// Answer: Will be invoked when there's activity with
// the MozContactChangeEvent (like) object:
//    { id: requestId,
//      event: MozContactChangeEvent }

/* globals FakeDOMRequest, FakeDOMCursorRequest, NavConnectHelper */

(function(window) {
  'use strict';

  function debug(text) {
    console.log('MANU *-*-*- MozContacts PF: ' + text);
  }

  // Wishful thinking at the moment...
  const CONTACTS_SERVICE = 'https://contactsservice.gaiamobile.org';

  // It's nice being monothread...
  var _currentRequestId = 1;

  // This should be on a common part in the future
  function _createAndQueueRequest(data, constructor) {
    var request = new constructor(++_currentRequestId, data);
    navConnPromise.
          then(navConnHelper => navConnHelper.sendObject(request));
    return request;
  }

  window.navigator.mozContacts = {
    _oncontactchange: null,
    _oncontactchangeId: null,

    get oncontactchange() {
      return this._oncontactchange;
    },

    set oncontactchange(cb) {
      this._oncontactchange = cb;
      if (this._oncontactchangeId) {
        return;
      }

      this._oncontactchangeId = this._oncontactchangeId || ++_currentRequestId;
      var commandObject = {
        serialize: function() {
          return {
            id: ++_currentRequestId,
            data: {
              operation: 'oncontactchange'
            },
            processAnswer: answer => self._oncontactchange &&
              self._oncontactchange(answer.event)
          };
        }
      };
      navConnPromise.
        then(navConnHelper => navConnHelper.sendObject(commandObject));
    },

    clear: function() {
      return _createAndQueueRequest({
        operation: 'clear'
      }, FakeDOMRequest);
    },

    find: function(options) {
      return _createAndQueueRequest({
        operation: 'find',
        params: [options]
      }, FakeDOMRequest);
    },

    getAll: function(options) {
      return _createAndQueueRequest({
        operation: 'getAll',
        params: [options]
      }, FakeDOMCursorRequest);
    },

    getCount: function() {
      return _createAndQueueRequest({
        operation: 'getCount'
      }, FakeDOMRequest);
    },

    getRevision: function() {
      return _createAndQueueRequest({
        operation: 'getRevision'
      }, FakeDOMRequest);
    },

    remove: function(contact) {
      return _createAndQueueRequest({
        operation: 'remove',
        params: [contact]
      }, FakeDOMRequest);
    },

    save: function(contact) {
      return _createAndQueueRequest({
        operation: 'save',
        params: [contact]
      }, FakeDOMRequest);
    }
  };

  /** POLYFILL PART **/
  var navConnPromise = new NavConnectHelper(CONTACTS_SERVICE);

  navConnPromise.then(function(){}, e => {
    debug('Got an exception while connecting ' + e);
    window.navigator.mozContacts = null;
  });

})(window);
