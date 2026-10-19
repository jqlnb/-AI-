const test = require('node:test');
const assert = require('node:assert/strict');
const { detectSensitiveInfo } = require('../web/src/privacy.mjs');

test('blocks obvious contact and identity information locally', () => {
  assert.equal(detectSensitiveInfo('请联系我 13812345678'), '手机号');
  assert.equal(detectSensitiveInfo('我的邮箱是 alice@example.com'), '邮箱地址');
  assert.equal(detectSensitiveInfo('身份证号：11010519491231002X'), '身份证号');
});

test('blocks credentials, financial numbers, and precise addresses locally', () => {
  assert.equal(detectSensitiveInfo('登录密码是 Abc12345!'), '密码或密钥');
  assert.equal(detectSensitiveInfo('银行卡号：6222021234567890123'), '银行卡号');
  assert.equal(detectSensitiveInfo('家庭住址：上海市徐汇区漕溪北路 88 号'), '家庭住址');
  assert.equal(detectSensitiveInfo('key: sk-123456789012345678901234'), '访问令牌或私钥');
});

test('does not block ordinary assignment messages', () => {
  assert.equal(detectSensitiveInfo('周五前完成高数第三章习题并提交学习通'), null);
});
