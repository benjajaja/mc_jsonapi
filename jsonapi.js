var net = require("net");
var crypto = require('crypto');

var getKey = function(methodName, username, password, salt) {
	var shasum = crypto.createHash('sha256');
	shasum.update(username + methodName + password + salt);
	return shasum.digest('hex');
};

var getLineCall = function(method, args, username, password, salt) {
	var line = '/api/call?method='+method;
	if (args) {
		line += '&args='+escape(JSON.stringify(args));
	}
	line += '&key='+getKey(method, username, password, salt)+'\n';
	return line;
};

var getLineSubscribe = function(channel, username, password, salt) {
	var line = '/api/subscribe?source='+channel;
	line += '&key='+getKey(channel, username, password, salt)+'\n';
	return line;
};

var createConnection = function(port, host, cb) {
	var socket = net.createConnection(port, host);
	socket.on('connect', function(e) {
		socket.removeAllListeners('connect');
		socket.removeAllListeners('error');
		cb(null, socket);
	});
	socket.on('error', function(e) {
		socket.removeAllListeners('connect');
		socket.removeAllListeners('error');
		cb(e, socket);
	});
};

var closeConnection = function(socket) {
	if (socket !== null) {
		socket.removeAllListeners('data');
		socket.removeAllListeners('end');
		socket.removeAllListeners('error');
	}
};



var JSONAPIConnection = function(port, username, password, salt) {
	var socket = null;
	var timer = null;
	var listeners = {'error': []};
	
	var onError = function(message, error) {
		for(var i = 0; i < listeners.error.length; i++) {
			listeners.error[i](message, error);
		}
	};
	
	var buffer = null;
	var pushData = function(newBuffer, cb) {
		if (buffer !== null) {
			var tmp = new Buffer(buffer.length + newBuffer.length);
			buffer.copy(tmp, 0);
			newBuffer.copy(tmp, buffer.length);
			buffer = tmp;
		} else {
			buffer = newBuffer;
		}
		
		if (buffer[buffer.length - 1] == 10) { // line feed
			var lines = buffer.toString().split('\n');
			
			for(var i = 0; i < lines.length - 1; i++) {
				cb(lines[i]);
			}
			
			buffer = null;
		} else {
			var lines = buffer.toString().split('\n');
			for(var i = 0; i < lines.length - 1; i++) {
				cb(lines[i]);
			}
			console.log('interrupted data at '+buffer.length+', flushed '+lines.length+' lines');
			
		}
	};
	
	return {
		connect: function(timeout, retries, cb) {
			console.log('connect to localhost:'+port);
			var connect = function() {
				createConnection(port, 'localhost', function(err, nsocket) {
					if (err) {
						//console.log(err);
						if (retries > 0) {
							console.log('connection failure, retrying...');
							retries--;
							timer = setTimeout(connect, timeout * 1000);
						} else {
							cb('Connection failed after '+retries+' retries. Send HUP to reload plugin(s) and try again.');
							
						}
					} else {
						socket = nsocket;
						
						socket.on('data', function(data) {
							pushData(data, function(line) {
								try {
									var result = JSON.parse(line);
									if (!result.result || result.result != 'success') {
										onError('result is not "success"', result);
										
									} else if (!result.source || result.success === false) {
										onError('result is "success", but "source" or "success" not set', result);
										
									} else {
										if (listeners[result.source]) {
											if (result.source != null && typeof listeners[result.source] != 'undefined') {	
												for(var j = 0; j < listeners[result.source].length; j++) {
													listeners[result.source][j](result.success);
												}
											} else {
												console.log('jsonapi: no listeners for source type "'+result.source+'".');
											}
										}
									}
								} catch (e) {
									onError('cannot parse JSON string "'+line+'"', e);
								}
							});
							
						});
						
						socket.on('end', function(data) {
							closeConnection(socket);
							socket = null;
						});
						socket.on('error', function(data) {
							closeConnection(socket);
							socket = null;
						});
						cb(true);						
					}
				});
			};
			connect();
		},
		
		on: function(event, listener) {
			if (!listeners[event]) {
				listeners[event] = [];
			}
			listeners[event].push(listener);
		},
		
		runMethod: function(method, args) {
			if (socket !== null) {
				var data = getLineCall(method, args, username, password, salt);
				socket.write(data);
				return data;
			} else {
				console.trace('jsonapi runMethod: socket is null!');
				return false;
			}
		},
		
		subscribe: function(channel) {
			if (socket !== null) {
				var data = getLineSubscribe(channel, username, password, salt);
				socket.write(data);
				return data;
			} else {
				return false;
			}
		},
		
		unload: function() {
			clearTimeout(timer);
			listeners = [];
			if (socket !== null) {
				socket.end();
				closeConnection(socket);
				socket = null;
			}
		}
	};
};

module.exports = JSONAPIConnection;