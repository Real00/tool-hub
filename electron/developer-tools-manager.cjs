const crypto = require("node:crypto");

const QUICK_LAUNCHER_TEXT_MAX_LENGTH = 4096;

const TRANSFORM_LABELS = {
  "json-format": "JSON Format Clipboard",
  "md5-hash": "MD5 Hash Clipboard",
  "url-decode": "URL Decode Clipboard",
  "url-encode": "URL Encode Clipboard",
  "unicode-decode": "Unicode Decode Clipboard",
  "unicode-encode": "Unicode Encode Clipboard",
  "base64-decode": "Base64 Decode Clipboard",
  "base64-encode": "Base64 Encode Clipboard",
  "timestamp-convert": "Timestamp Convert Clipboard",
};

const COMMON_TIMEZONES = [
  { label: "UTC", timeZone: "UTC" },
  { label: "Asia/Shanghai", timeZone: "Asia/Shanghai" },
  { label: "Asia/Tokyo", timeZone: "Asia/Tokyo" },
  { label: "Europe/London", timeZone: "Europe/London" },
  { label: "America/New_York", timeZone: "America/New_York" },
  { label: "America/Los_Angeles", timeZone: "America/Los_Angeles" },
];

function normalizeInputText(input) {
  const value = String(input ?? "");
  if (!value) {
    return "";
  }
  return value.length > QUICK_LAUNCHER_TEXT_MAX_LENGTH
    ? value.slice(0, QUICK_LAUNCHER_TEXT_MAX_LENGTH)
    : value;
}

function normalizeTrimmedInput(input) {
  return normalizeInputText(input).trim();
}

function isLikelyUrlEncoded(input) {
  const value = normalizeTrimmedInput(input);
  if (!value) {
    return false;
  }
  if (!/%[0-9a-f]{2}/i.test(value) && !/\+/.test(value)) {
    return false;
  }
  try {
    const decoded = decodeURIComponent(value.replace(/\+/g, "%20"));
    return decoded !== value;
  } catch {
    return false;
  }
}

function isLikelyJsonText(input) {
  const value = normalizeTrimmedInput(input);
  if (!value || (!value.startsWith("{") && !value.startsWith("["))) {
    return false;
  }
  try {
    const parsed = JSON.parse(value);
    return !!parsed && typeof parsed === "object";
  } catch {
    return false;
  }
}

function hashMd5Text(input) {
  return crypto.createHash("md5").update(String(input ?? ""), "utf8").digest("hex");
}

function decodeUrlText(input) {
  const value = normalizeInputText(input);
  if (!value.trim()) {
    return "";
  }
  return decodeURIComponent(value.replace(/\+/g, "%20"));
}

function encodeUrlText(input) {
  return encodeURIComponent(String(input ?? ""));
}

function isLikelyUnicodeEscaped(input) {
  const value = normalizeInputText(input);
  return /\\u[0-9a-f]{4}/i.test(value) || /\\x[0-9a-f]{2}/i.test(value);
}

function decodeUnicodeText(input) {
  const value = normalizeInputText(input);
  return value
    .replace(/\\u([0-9a-f]{4})/gi, (_match, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_match, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)));
}

function encodeCodePointAsUnicode(codePoint) {
  if (codePoint <= 0xffff) {
    return `\\u${codePoint.toString(16).padStart(4, "0").toUpperCase()}`;
  }
  const adjusted = codePoint - 0x10000;
  const high = 0xd800 + ((adjusted >> 10) & 0x3ff);
  const low = 0xdc00 + (adjusted & 0x3ff);
  return `\\u${high.toString(16).padStart(4, "0").toUpperCase()}\\u${low
    .toString(16)
    .padStart(4, "0")
    .toUpperCase()}`;
}

function encodeUnicodeText(input) {
  let output = "";
  const value = String(input ?? "");
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (char === "\\") {
      output += "\\u005C";
      continue;
    }
    if (char === "\n") {
      output += "\\u000A";
      continue;
    }
    if (char === "\r") {
      output += "\\u000D";
      continue;
    }
    if (char === "\t") {
      output += "\\u0009";
      continue;
    }
    if (codePoint >= 0x20 && codePoint <= 0x7e) {
      output += char;
      continue;
    }
    output += encodeCodePointAsUnicode(codePoint);
  }
  return output;
}

function normalizeBase64Input(input) {
  return normalizeTrimmedInput(input).replace(/\s+/g, "");
}

function decodeBase64Buffer(input) {
  const value = normalizeBase64Input(input);
  if (!value || value.length % 4 !== 0) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return null;
  }
  try {
    const buffer = Buffer.from(value, "base64");
    if (!buffer || buffer.length === 0) {
      return null;
    }
    if (buffer.toString("base64") !== value) {
      return null;
    }
    return buffer;
  } catch {
    return null;
  }
}

function decodeBase64Text(input) {
  const buffer = decodeBase64Buffer(input);
  if (!buffer) {
    throw new Error("Input is not a valid Base64 string.");
  }
  const text = buffer.toString("utf8");
  if (text.includes("\uFFFD")) {
    throw new Error("Base64 content is not valid UTF-8 text.");
  }
  if (Buffer.from(text, "utf8").toString("base64") !== normalizeBase64Input(input)) {
    throw new Error("Base64 content is not a stable UTF-8 text payload.");
  }
  return text;
}

function encodeBase64Text(input) {
  return Buffer.from(String(input ?? ""), "utf8").toString("base64");
}

function isLikelyBase64Text(input) {
  try {
    return !!decodeBase64Text(input);
  } catch {
    return false;
  }
}

function detectTimestampKind(input) {
  const value = normalizeTrimmedInput(input);
  if (/^\d{10}$/.test(value)) {
    return "seconds";
  }
  if (/^\d{13}$/.test(value)) {
    return "milliseconds";
  }
  return null;
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function isValidDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const numericHour = Number(hour);
  const numericMinute = Number(minute);
  const numericSecond = Number(second);
  if (
    !Number.isInteger(numericYear) ||
    !Number.isInteger(numericMonth) ||
    !Number.isInteger(numericDay) ||
    !Number.isInteger(numericHour) ||
    !Number.isInteger(numericMinute) ||
    !Number.isInteger(numericSecond)
  ) {
    return false;
  }
  if (
    numericMonth < 1 ||
    numericMonth > 12 ||
    numericDay < 1 ||
    numericDay > 31 ||
    numericHour < 0 ||
    numericHour > 23 ||
    numericMinute < 0 ||
    numericMinute > 59 ||
    numericSecond < 0 ||
    numericSecond > 59
  ) {
    return false;
  }
  const date = new Date(
    numericYear,
    numericMonth - 1,
    numericDay,
    numericHour,
    numericMinute,
    numericSecond,
    0,
  );
  return (
    date.getFullYear() === numericYear &&
    date.getMonth() === numericMonth - 1 &&
    date.getDate() === numericDay &&
    date.getHours() === numericHour &&
    date.getMinutes() === numericMinute &&
    date.getSeconds() === numericSecond
  );
}

function formatLocalDateTimeFromParts(
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
) {
  return `${year}-${padDatePart(month)}-${padDatePart(day)} ${padDatePart(hour)}:${padDatePart(minute)}:${padDatePart(second)}`;
}

function parseCommonDateFormat(input) {
  const value = normalizeTrimmedInput(input);
  if (!value) {
    return null;
  }

  let match = value.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (match) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
    if (!isValidDateParts(year, month, day, hour, minute, second)) {
      return null;
    }
    return {
      date: new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        0,
      ),
      inputKind: match[4] ? "date-time-text" : "date-text",
      normalizedText: formatLocalDateTimeFromParts(year, month, day, hour, minute, second),
    };
  }

  match = value.match(/^(\d{4})(\d{2})(\d{2})(?:[ T]?(\d{2})(\d{2})(\d{2})?)?$/);
  if (match) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
    const hasTime = Boolean(match[4] && match[5]);
    if (!isValidDateParts(year, month, day, hour, minute, second)) {
      return null;
    }
    return {
      date: new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        0,
      ),
      inputKind: hasTime ? "date-time-compact" : "date-compact",
      normalizedText: formatLocalDateTimeFromParts(year, month, day, hour, minute, second),
    };
  }

  match = value.match(/^(\d{4})(\d{2})(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const [, year, month, day, hour, minute, second = "00"] = match;
    if (!isValidDateParts(year, month, day, hour, minute, second)) {
      return null;
    }
    return {
      date: new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        0,
      ),
      inputKind: "date-time-mixed",
      normalizedText: formatLocalDateTimeFromParts(year, month, day, hour, minute, second),
    };
  }

  return null;
}

function parseDateLikeInput(input) {
  const value = normalizeTrimmedInput(input);
  if (!value) {
    return null;
  }
  const timestampKind = detectTimestampKind(value);
  if (timestampKind === "seconds") {
    const milliseconds = Number(value) * 1000;
    if (!Number.isFinite(milliseconds)) {
      return null;
    }
    return {
      date: new Date(milliseconds),
      inputKind: "unix-seconds",
      normalizedText: value,
    };
  }
  if (timestampKind === "milliseconds") {
    const milliseconds = Number(value);
    if (!Number.isFinite(milliseconds)) {
      return null;
    }
    return {
      date: new Date(milliseconds),
      inputKind: "unix-milliseconds",
      normalizedText: value,
    };
  }

  const commonFormat = parseCommonDateFormat(value);
  if (commonFormat) {
    return commonFormat;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return {
    date,
    inputKind: "date-string",
    normalizedText: value,
  };
}

function isHighConfidenceTimestampConvertibleInput(input) {
  const value = normalizeTrimmedInput(input);
  if (!value) {
    return false;
  }
  return !!detectTimestampKind(value) || !!parseCommonDateFormat(value);
}

function formatDateInTimeZone(date, timeZone) {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date).replace(" ", " ");
  } catch {
    return "Unavailable";
  }
}

function formatCurrentTimestampSummary(date = new Date()) {
  const milliseconds = date.getTime();
  const seconds = Math.floor(milliseconds / 1000);
  const lines = [
    "[Current]",
    `Seconds: ${seconds}`,
    `Milliseconds: ${milliseconds}`,
    `Local time: ${date.toLocaleString()}`,
    `ISO time: ${date.toISOString()}`,
    "Time zones:",
  ];

  for (let i = 0; i < COMMON_TIMEZONES.length; i += 1) {
    const item = COMMON_TIMEZONES[i];
    lines.push(`- ${item.label}: ${formatDateInTimeZone(date, item.timeZone)}`);
  }
  return lines.join("\n");
}

function formatTimestampOutput(input) {
  const raw = normalizeTrimmedInput(input);
  if (!raw) {
    return formatCurrentTimestampSummary();
  }

  const parsed = parseDateLikeInput(raw);
  if (!parsed?.date || Number.isNaN(parsed.date.getTime())) {
    throw new Error("Input is not a supported timestamp or date string.");
  }

  const { date, inputKind, normalizedText } = parsed;
  const milliseconds = date.getTime();
  const seconds = Math.floor(milliseconds / 1000);
  const lines = [
    "[Input]",
    `Input type: ${inputKind}`,
    `Input value: ${raw}`,
    `Normalized: ${normalizedText}`,
    `Seconds: ${seconds}`,
    `Milliseconds: ${milliseconds}`,
    `Local time: ${date.toLocaleString()}`,
    `ISO time: ${date.toISOString()}`,
    "Time zones:",
  ];

  for (let i = 0; i < COMMON_TIMEZONES.length; i += 1) {
    const item = COMMON_TIMEZONES[i];
    lines.push(`- ${item.label}: ${formatDateInTimeZone(date, item.timeZone)}`);
  }
  return lines.join("\n");
}

function pushTransform(output, transformId) {
  if (!output.includes(transformId)) {
    output.push(transformId);
  }
}

function analyzeDeveloperToolsText(input) {
  const rawText = normalizeInputText(input);
  const trimmedText = rawText.trim();
  const detectedTransforms = [];
  let suggestedTransform = null;

  if (!trimmedText) {
    return {
      rawText,
      detectedTransforms,
      suggestedTransform,
    };
  }

  if (isLikelyUrlEncoded(trimmedText)) {
    pushTransform(detectedTransforms, "url-decode");
    pushTransform(detectedTransforms, "url-encode");
    suggestedTransform ||= "url-decode";
  }

  if (isLikelyJsonText(trimmedText)) {
    pushTransform(detectedTransforms, "json-format");
    suggestedTransform ||= "json-format";
  }

  if (isLikelyUnicodeEscaped(trimmedText)) {
    pushTransform(detectedTransforms, "unicode-decode");
    pushTransform(detectedTransforms, "unicode-encode");
    suggestedTransform ||= "unicode-decode";
  }

  if (isLikelyBase64Text(trimmedText)) {
    pushTransform(detectedTransforms, "base64-decode");
    pushTransform(detectedTransforms, "base64-encode");
    suggestedTransform ||= "base64-decode";
  }

  if (isHighConfidenceTimestampConvertibleInput(trimmedText) || (!suggestedTransform && parseDateLikeInput(trimmedText))) {
    pushTransform(detectedTransforms, "timestamp-convert");
    suggestedTransform ||= "timestamp-convert";
  }

  return {
    rawText,
    detectedTransforms,
    suggestedTransform,
  };
}

function runDeveloperToolsTransform(input, transformIdInput) {
  const transformId = String(transformIdInput ?? "").trim();
  const sourceText = normalizeInputText(input);
  if (!transformId) {
    throw new Error("Transform id is required.");
  }

  let outputText = "";
  if (transformId === "md5-hash") {
    outputText = hashMd5Text(sourceText);
  } else if (transformId === "url-decode") {
    outputText = decodeUrlText(sourceText);
  } else if (transformId === "url-encode") {
    outputText = encodeUrlText(sourceText);
  } else if (transformId === "unicode-decode") {
    outputText = decodeUnicodeText(sourceText);
  } else if (transformId === "unicode-encode") {
    outputText = encodeUnicodeText(sourceText);
  } else if (transformId === "base64-decode") {
    outputText = decodeBase64Text(sourceText);
  } else if (transformId === "base64-encode") {
    outputText = encodeBase64Text(sourceText);
  } else if (transformId === "timestamp-convert") {
    outputText = formatTimestampOutput(sourceText);
  } else {
    throw new Error(`Unsupported transform: ${transformId}`);
  }

  return {
    transformId,
    outputText,
  };
}

function getQuickLauncherClipboardDeveloperToolsContext(input) {
  const rawText = normalizeInputText(input);
  const trimmedText = rawText.trim();
  if (!trimmedText) {
    return null;
  }

  const detectedTransforms = [];
  let suggestedTransform = null;

  if (isLikelyUrlEncoded(trimmedText)) {
    pushTransform(detectedTransforms, "url-decode");
    pushTransform(detectedTransforms, "url-encode");
    suggestedTransform ||= "url-decode";
  }
  if (isLikelyJsonText(trimmedText)) {
    pushTransform(detectedTransforms, "json-format");
    suggestedTransform ||= "json-format";
  }
  if (isLikelyUnicodeEscaped(trimmedText)) {
    pushTransform(detectedTransforms, "unicode-decode");
    pushTransform(detectedTransforms, "unicode-encode");
    suggestedTransform ||= "unicode-decode";
  }
  if (isLikelyBase64Text(trimmedText)) {
    pushTransform(detectedTransforms, "base64-decode");
    pushTransform(detectedTransforms, "base64-encode");
    suggestedTransform ||= "base64-decode";
  }
  if (isHighConfidenceTimestampConvertibleInput(trimmedText)) {
    pushTransform(detectedTransforms, "timestamp-convert");
    suggestedTransform ||= "timestamp-convert";
  }
  if (detectedTransforms.length === 0) {
    return null;
  }

  const actions = detectedTransforms.map((transformId) => ({
    id: transformId,
    label: TRANSFORM_LABELS[transformId] || transformId,
    description: rawText,
    suggestedTransform: transformId,
  }));
  return {
    rawText,
    suggestedTransform,
    actions,
  };
}

module.exports = {
  analyzeDeveloperToolsText,
  getQuickLauncherClipboardDeveloperToolsContext,
  runDeveloperToolsTransform,
};
