// XMLHttpRequest polyfill!
// https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest

// I have to define the service protocol, and this is as good place as any. The
// protocol will be as follows:
// * Each request will have a numeric request id, set by the client
// * The answers will include the request id, so the client can know to which
//   request the answer corresponds

// createXMLHttpRequest =>
//   * Request: { id: requestId,
//                data: {
//                       operation: 'createXMLHttpRequest',
//                       options: options
//                      }
//              }
//   * Answer:  { id: requestId, error: error}
//     (answer.error truthy means there was an error)
// Once you get an answer you can assume than the id is the identifier of the
// remote XMLHttpRequest

// For all the operations over a XMLHttpRequest:
//  * Request: { id: requestId,
//               data: {
//                 xhrId: xhrId,
//                 operation: methodName,
//                 params: params
//               }
//             }
// * Answer (only those methods that return something): { id: requestId,
//             result|error: Whatever }

// For the EventTarget operations
//  Request: { id: requestId,
//             data: {
//             operation: 'addEventListener|removeEventListener|dispatchEvent',
//             type: eventType (only addEventListener and removeEventListener),
//             useCapture: true|false (only addEventListener),
//             event: eventToDispatch (only dispatchEvent),
//             cb: callback
//           },
// Answer: When invoked:
//    { id: requestId,
//      data: EventTargetEvent }


(function(window) {

  'use strict';

  function debug(text) {
    console.log('*-*-*- System XHR PF: ' + text);
  }

  // Wishful thinking at the moment...
  const SYSTEMXHR_SERVICE = 'https://systemxhrservice.gaiamobile.org';

  // XMLHttpRequest polyfill..
  function FakeXMLHttpRequest(reqId, extraData) {

    var _resolve, _reject;
    var _systemxhr = new Promise((resolve, reject) => {
      _resolve = resolve;
      _reject = reject;
    });

    // This will hold the remote object, once the lock is actually created..
    var _xhrId = null;
    _systemxhr.then(id => _xhrId = id);
    var self = this;

    function OnReadyStateChangeRequest(reqId, extraData) {
      this.serialize = () => {
        return {
          id: reqId,
          data: extraData,
          processAnswer: answer => {
            if (answer.event) {
              self._updateXMLHttpRequestObject(answer.event);
              self.onreadystatechange && self.onreadystatechange(answer.event);
            }
          }
        };
      };
    }

    function OnChangeRequest(reqId, extraData) {
      this.serialize = () => {
        return {
          id: reqId,
          data: extraData,
          processAnswer: answer => {
            if (answer.event) {
              self['_' + extraData.operation](answer.event);
            }
          }
        };
      };
    }


    function _listenerCallback(evt, cb) {
      this._updateXMLHttpRequestObject.call(this, evt);

      cb(evt);
    }

    FakeEventTarget.call(this, navConnHelper, _listenerCallback.bind(this),
      'xhrId', _systemxhr);

    [{
      method: 'abort',
      numParams: 0,
    },
    {
      method: 'open',
      numParams: 5,
    },
    {
      method: 'overrideMimeType',
      numParams: 1,
    },
    {
      method: 'send',
      numParams: 1,
    },
    {
      method: 'setRequestHeader',
      numParams: 2,
    },
    {
      objectMethod: '_onreadystatechange',
      method: 'onreadystatechange',
      numParams: 0,
      returnValue: OnReadyStateChangeRequest,
    }].forEach(methodInfo => {
      var method = methodInfo.objectMethod || methodInfo.method;
      this[method] = navConnHelper.methodCall.bind(navConnHelper,
        {
          methodName: methodInfo.method,
          numParams: methodInfo.numParams,
          returnValue: methodInfo.returnValue || VoidRequest,
          promise: _systemxhr,
          field: 'xhrId'
        });
    });

    // Null if no response has been received yet
    this._responseHeaders = null;
    this.getResponseHeader = function(header) {
      return this._responseHeaders[header] ?
        this._responseHeaders[header] : null;
    };

    this.getAllResponseHeaders = function() {
      var headers = '';

      if (!this._responseHeaders) {
        return null;
      }

      for (var header in this._responseHeaders) {
        headers += header + ': ' + this._responseHeaders[header] + ' \n';
      }

      return headers;
    };

    var readyStates = [
      {property: 'UNSENT', value: 0},
      {property: 'OPENED', value: 1},
      {property: 'HEADERS_RECEIVED', value: 2},
      {property: 'LOADING', value: 3},
      {property: 'DONE', value: 4},
    ];

    readyStates.forEach(state => {
      Object.defineProperty(this, state.property, {
        enumerable: true,
        value: state.value
      });
    });

    this.upload = new FakeXMLHttpRequestUpload();

    var properties = [
      'response', 'responseText', 'responseType', 'responseXML',
      'status', 'statusText', 'readyState',' timeout', 'responseURL'
    ];

    properties.forEach(property => {
      Object.defineProperty(this, property, {
        enumerable: true,
        get: function() {
          if (property === 'response') {
            self._convertToResponseType();
          }
          return self['_' + property];
        },
        set: function(value) {
          self['_' + property] = value;
        }
      });
    });

    this._convertToResponseType = function() {
      if (typeof this._response !== 'string') {
        return;
      }

      var type = this._responseType;
      var value;
      switch (type) {
        case 'arraybuffer':
          value = base64DecToArr(this._response).buffer;
          break;
        case 'blob':
          break;
        case 'document':
          var doctype = document.implementation.createDocumentType('html',
            '', '');
          value = document.implementation.createDocument('', 'html', doctype);
          value.documentElement.innerHTML = this._response;
          break;
        case 'json':
          value = JSON.parse(this._response);
          break;
        case 'moz-blob':
          break;
        case 'moz-chunked-text':
          break;
        case 'moz-chunked-arraybuffer':
          break;
        case 'text':
        case '':
          value = this._response;
        default:
          break;
      }
      this._response = value;
    };

    Object.defineProperty(this, 'onreadystatechange', {
      get: function() {
        return this._onreadystatechangecb;
      },

      set: function(cb) {
        this._onreadystatechangecb = cb;
      }
    });

    this._updateXMLHttpRequestObject = function(evt) {
      properties.forEach(property => {
        if (property !== 'responseType')
          this['_' + property] = evt.target[property];
      });
      this['_responseHeaders'] = evt.responseHeaders;
    };

    this._onchange = function(changeType, cb) {
      this['_on' + changeType] = cb;
      navConnHelper.methodCall({
                                 methodName: 'on' + changeType,
                                 numParams: 0,
                                 returnValue: OnChangeRequest,
                                 promise: _systemxhr,
                                 field: 'xhrId'
                               });
    };

    // Inherited properties from XMLHttpRequestEventTarget
    var onChangeEvents = [
      'abort',
      'error',
      'load',
      'loadend',
      'loadstart',
      'progress',
      'timeout',
    ];

    onChangeEvents.forEach(changeEvent => {
      Object.defineProperty(this, 'on' + changeEvent, {
        set: function(cb) {
          this._onchange(changeEvent, cb);
        }
      });
    });

    this.serialize = function() {
      return {
        id: reqId,
        data: {
          operation: 'createXMLHttpRequest',
          options: extraData.options
        },
        processAnswer: function(answer) {
          if (!answer.error) {
            _resolve(answer.id);
          } else {
            _reject(answer.error);
          }
        }
      };
    };

    this._onreadystatechange();
  }

  function FakeXMLHttpRequestUpload() {
    // Inherited properties from XMLHttpRequestEventTarget
    var onChangeEvents = [
      'abort',
      'error',
      'load',
      'loadend',
      'loadstart',
      'progress',
      'timeout',
    ];

    onChangeEvents.forEach(changeEvent => {
      Object.defineProperty(this, 'on' + changeEvent, {
        set: function(cb) {
          this._onchange(changeEvent, cb);
        }
      });
    });
  }

  var navConnHelper = new NavConnectHelper(SYSTEMXHR_SERVICE);
  var realXMLHttpRequest = window.XMLHttpRequest.bind(window);

  function XMLHttpRequestShim(options) {
    if (options && options.mozSystem) {
      return navConnHelper.createAndQueueRequest({
                                                    options: options
                                                  }, FakeXMLHttpRequest);
    } else {
      return new realXMLHttpRequest(options);
    }
  };

  window.XMLHttpRequest = XMLHttpRequestShim;

  navConnHelper.then(function() {}, e => {
    debug('Got an exception while connecting ' + e);
    window.XMLHttpRequest = realXMLHttpRequest;
  });

})(window);
