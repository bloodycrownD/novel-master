/**
 * RN 专用 AWS SDK XML 解析：使用 fast-xml-parser，避免 browser 版 DOMParser。
 * Metro 将 @aws-sdk/xml-builder 的 xml-parser 重定向到本文件。
 */
const {XMLParser} = require('fast-xml-parser');

const parser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  ignoreDeclaration: true,
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: true,
});

/** @param {string} xmlString */
function parseXML(xmlString) {
  return parser.parse(xmlString, true);
}

parseXML.__rnShim = 'fast-xml-parser-mobile';

module.exports = {parseXML};
module.exports.parseXML = parseXML;
