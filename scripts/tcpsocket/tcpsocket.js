// navigator.mozTCPSocket polyfill!
// https://developer.mozilla.org/en-US/docs/Web/API/TCP_Socket_API

// I have to define the service protocol, and this is as good place as any. The
// protocol will be as follows:
// * Each request will have a numeric request id, set by the client
// * The answers will include the request id, so the client can know to which
//   request the answer corresponds
// * The request id will also act as identifier for remote objects
//    (connections!)

// The TCPSocket API is:

//  readonly attribute DOMString host;
//  readonly attribute unsigned short port;
//  readonly attribute boolean ssl;
//  readonly attribute unsigned long bufferedAmount;
//  readonly attribute DOMString readyState;
//  readonly attribute DOMString binaryType;
//  nsIDOMTCPSocket open(in DOMString host, in unsigned short port,
//                       [optional] in jsval options);
//  nsIDOMTCPServerSocket listen(in unsigned short localPort,
//                               [optional] in jsval options,
//                               [optional] in unsigned short backlog);
//  void upgradeToSecure();
//  void suspend();
//  void resume();
//  void close();
//  boolean send(in jsval data, [optional] in unsigned long byteOffset,
//              [optional] in unsigned long byteLength);
//  attribute jsval onopen;
//  attribute jsval ondrain;
//  attribute jsval ondata;
//  attribute jsval onerror;
//  attribute jsval onclose;

// Attributes are cached locally and updated from the real attribute when they
// change
// Note that this means that at some points is possible they're sligthly
// delayed.


//  nsIDOMTCPSocket open(in DOMString host, in unsigned short port,
//                       [optional] in jsval options);
//   * Request: { id: requestId,
//                data: {
//                  operation: 'open',
//                  host: host,
//                  port: port,
//                  options: options
//                }
//               }
//   * Answer:  { id: requestId, error: error}
// Once you get an answer you can assume than the id is the identifier of the
// remote socket. Note that this does *not* mean that the socket has connected
// already!
//
//  void upgradeToSecure();
//  void suspend();
//  void resume();
//  void close();
//  * Request: { id: requestId,
//               data: {
//                 socketId: idFromOpen
//                 operation: methodName
//               }
//             }
// * Answer: { id: requestId,
//             result|error: Whatever }

// For the on* operation
//  Request: { id: requestId,
//             data: {
//             operation: 'on' + eventType,
//             socketId: idFromOpen
//           },
// Answer: The handler will be invoked when the event fires:
//    { id: requestId,
//      data: whatever }


(function(window) {

  'use strict';

  function debug(text) {
    console.log('MANU *-*-*- TCPSocket PF: ' + text);
  }

  if (false && window.navigator.mozTCPSocket &&
      window.navigator.mozTCPSocket.open) {
    // Hmm it's already available... so let's just use it and be done with it
    return;
  }

  // Wishful thinking at the moment...
  const TCPSOCKET_SERVICE = 'https://tcpsocketservice.gaiamobile.org';

  // TCPSocket polyfill..
  function FakeTCPSocket(reqId, extraData) {
    // extraData will hold host, port, options
    // Crude error checking!
    if (!extraData.host) {
      throw "INVALID_HOST";
    }
    if (!extraData.port) {
      throw "INVALID_PORT";
    }

    var host = extraData.host;
    var port = extraData.port;
    var options = extraData.options;

    var _resolve, _reject;
    var _sock = new Promise((resolve, reject) => {
      _resolve = resolve;
      _reject = reject;
    });

    // This will hold the remote object, once the lock is actually created..
    var _sockId = null;
    _sock.then(id => _sockId = id);

    Object.defineProperty(this, 'host', {
      get: function() {
        return host;
      }
    });

    Object.defineProperty(this, 'port', {
      get: function() {
        return port;
      }
    });

    var _internalProps = {
      ssl: !!options.useSecureTransport,
      bufferedAmount: 0,
      readyState: "connecting",
      binaryType: options.binaryType == "arraybuffer" ? "arraybuffer"
                                                      : "string"
    };

    Object.keys(_internalProps).forEach(key =>
      Object.defineProperty(this, key, {
        get: function() {
          return _internalProps[key];
        }
      })
    );

    var _handlers = {
      onopen: null,
      ondrain: null,
      ondata: null,
      onerror: null,
      onclose: null
    };

    function _sendAPICall(commandObject) {
      Promise.all([navConnPromise, _sock]).then(values => {
        // Going to send the socketId always in this place...
        commandObject.data.socketId = values[1];
        values[0].sendObject(commandObject);
      });
    }

    var self = this;

    Object.keys(_handlers).forEach(handler =>
      Object.defineProperty(this, handler, {
        get: function() {
          return _handlers[handler];
        },
        set: function(cb) {
          _handlers[handler] = cb;
          function preprocessEvent(event) {
            if (event.type === 'data' && self.binaryType === 'arraybuffer') {
              // Returning a ArrayBuffer cause that's what we really get
              event.data = Uint8Array.from(event.data).buffer;
            }
            cb(event);
          }
          navConnPromise.queueDependentRequest(
            {handler: handler, cb: preprocessEvent},
            HandlerSetRequest,
            _sock, 'socketId');
        }
      })
    );

    this.serialize = function() {
      return {
        id: reqId,
        data: {
          operation: 'open',
          params: [host, port, options]
        },
        processAnswer: function(answer) {
          // This function will be invoked in two cases... when the socket is
          // created and any time we have to update something...
          if (_sockId === null) {
            if (!answer.error) {
              _resolve(answer.socketId);
              _internalProps.readyState = 'open';
            } else {
              var permaFail = 'Error creating socket: ' + answer.error;
              _internalProps.readyState = 'closed';
              _reject(permaFail);
            }
            return;
          }

          // Ok, so if we're here then the remote side has detected some kind of
          // change that we have to apply locally...
          // TO-DO: Stick it for now
          debug('FIX-ME! I got some message that I\'m not treating yet!');
        }
      };
    };

    var _ops = {
      upgradeToSecure: {
        numParams: 0,
        returnValue: VoidRequest
      },
      suspend: {
        numParams: 0,
        returnValue: VoidRequest
      },
      resume: {
        numParams: 0,
        returnValue: VoidRequest
      },
      close: {
        numParams: 0,
        returnValue: VoidRequest
      }
    };

    for (var _op in _ops) {
      this[_op] =
        navConnPromise.methodCall.bind(navConnPromise,
                                       {
                                         methodName: _op,
                                         numParams: _ops[_op].numParams,
                                         returnValue: _ops[_op].returnValue,
                                         promise: _sock,
                                         field: 'socketId'
                                       });
    }

    // boolean send(in jsval data, [optional] in unsigned long byteOffset,
    //              [optional] in unsigned long byteLength);
    // Synchronous API agh!
    this.send = function(dataToSend, byteOffset, byteLength) {
      // Hmm... can uint8 be sent?
      if (this.readyState !== 'open') {
        debug('I\'m not ready');
        return false;
      }
      if (this.binaryType === 'arraybuffer') {
        // Data is/should be a Uint8Array
        if (dataToSend.byteLength === undefined) {
          // Probably this is the wrong exception type, but don't care ATM.
          throw 'INVALID_DATA_TYPE';
        }
        // Not very efficient, this, but IAC doesn't like Uint8Arrays
        dataToSend = Array.from(new Uint8Array(dataToSend));
      }
      navConnPromise.methodCall(
        {
          methodName: 'send',
          numParams: 3,
          returnValue: VoidRequest,
          promise: _sock,
          field: 'socketId'
        },
        dataToSend, byteOffset, byteLength
      );
      return true;
    };
  }

  // For the time being, only client sockets!
  // Also we only need to implement open here (or the constructor if the
  // constructor worked)
  window.navigator.mozTCPSocket = {
    open: function(host, port, options) {
      return navConnPromise.createAndQueueRequest({
        host: host,
        port: port,
        options: options
      }, FakeTCPSocket);
    }
  };

  var navConnPromise = new NavConnectHelper(TCPSOCKET_SERVICE);

  navConnPromise.then(function(){}, e => {
    debug('Got an exception while connecting ' + e);
    window.navigator.mozTCPSocket = null;
  });

})(window);
