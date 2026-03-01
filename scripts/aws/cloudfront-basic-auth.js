import cf from 'cloudfront';

const kvsHandle = cf.kvs();

async function handler(event) {
    var request = event.request;
    var headers = request.headers;

    try {
        if (headers.authorization && headers.authorization.value.startsWith('Basic ')) {
            var base64Credentials = headers.authorization.value.substring(6);
            var credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');

            var separatorIndex = credentials.indexOf(':');
            if (separatorIndex !== -1) {
                var username = credentials.substring(0, separatorIndex);
                var password = credentials.substring(separatorIndex + 1);

                // KVSからハッシュ取得
                var expectedHash = await kvsHandle.get(username);
                if (expectedHash) {
                    var crypto = require('crypto');
                    // USERNAME をソルトとして追加し、脆弱なハッシュ化を軽減 (Issue #26)
                    var providedHash = crypto.createHash('sha256').update(username + ':' + password).digest('hex');

                    if (providedHash === expectedHash) {
                        return request;
                    }
                }
            }
        }
    } catch (e) {
        console.log('Auth Error: ' + e);
    }

    return {
        statusCode: 401,
        statusDescription: 'Unauthorized',
        headers: {
            'www-authenticate': { value: 'Basic realm="Secure Area"' }
        }
    };
}
