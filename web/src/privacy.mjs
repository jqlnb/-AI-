const sensitivePatterns = [
  { label: '手机号', pattern: /(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d{9}(?!\d)/ },
  { label: '邮箱地址', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: '身份证号', pattern: /(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?!\w)/ },
  { label: '银行卡号', pattern: /(?:银行卡(?:号)?|银行账号|卡号)\s*(?:为|是|[:：=])?\s*(?:\d[ -]?){13,19}/i },
  { label: '密码或密钥', pattern: /(?:密码|口令|验证码|登录凭证|access[ _-]?token|api[ _-]?key|secret[ _-]?key|私钥|密钥)\s*(?:为|是|[:：=])\s*[^\s，。；,;]{3,}/i },
  { label: '家庭住址', pattern: /(?:家庭住址|家庭地址|详细住址|详细地址|住址|地址)\s*(?:为|是|[:：=])\s*[^，。；\n]{6,}/i },
  { label: '访问令牌或私钥', pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/ },
];

export function detectSensitiveInfo(value) {
  const text = String(value ?? '');
  return sensitivePatterns.find(({ pattern }) => pattern.test(text))?.label ?? null;
}
