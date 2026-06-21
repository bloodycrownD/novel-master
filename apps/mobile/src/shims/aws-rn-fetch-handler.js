/**
 * RN 兼容 FetchHttpHandler：物化响应体为 Blob/ReadableStream + sdkStreamMixin。
 */
const {FetchHttpHandler} = require('@smithy/fetch-http-handler');
const {
  collectResponseBytes,
  toSdkResponseBody,
} = require('./aws-rn-stream-collector');

class RnFetchHttpHandler extends FetchHttpHandler {
  async handle(request, options) {
    const result = await super.handle(request, options);
    const response = result?.response;
    if (response?.body != null) {
      const bytes = await collectResponseBytes(response.body);
      response.body = toSdkResponseBody(bytes);
    }
    return result;
  }
}

module.exports = {RnFetchHttpHandler, collectResponseBytes};
