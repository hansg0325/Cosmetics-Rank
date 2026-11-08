import React, { useEffect, useState } from "react";
import { keywordRulesSchema, type KeywordRule } from "../shared/keywordRules";
function AliasEditor({
  value,
  onChange,
  index,
}: {
  value: string;
  onChange: (value: string) => void;
  index: number;
}) {
  const [input, setInput] = useState("");
  const words = value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  function add() {
    const next = input
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (next.length) onChange([...new Set([...words, ...next])].join(", "));
    setInput("");
  }
  return (
    <div className="keyword-aliases">
      {words.map((word, n) => (
        <span className="keyword-chip" key={`${word}-${n}`}>
          {word}
          <button
            type="button"
            aria-label={`${word} 제외`}
            onClick={() => onChange(words.filter((_, i) => i !== n).join(", "))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        aria-label={`포함할 단어 ${index + 1}`}
        placeholder="단어 추가"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
      />
    </div>
  );
}
type Draft = { display: string; includes: string };
export function KeywordSettings() {
  const [rows, setRows] = useState<Draft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState("");
  const dirty = loaded && JSON.stringify(rows) !== saved;
  useEffect(() => {
    void fetch("/api/settings/keywords")
      .then(async (r) => {
        if (!r.ok) throw Error("키워드를 불러오지 못했습니다.");
        const rules = (await r.json()) as KeywordRule[];
        const drafts = rules.map((r) => ({
          display: r.display,
          includes: r.includes.join(", "),
        }));
        setRows(drafts);
        setSaved(JSON.stringify(drafts));
        setLoaded(true);
      })
      .catch((e) => setMessage(String(e)));
  }, []);
  function edit(index: number, field: keyof Draft, value: string) {
    setRows(
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const rules = keywordRulesSchema.parse(
        rows.map((row) => ({
          display: row.display,
          includes: [
            ...new Set(
              row.includes
                .split(/[,\n]/)
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ],
        })),
      );
      const r = await fetch("/api/settings/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules),
      });
      if (!r.ok) throw Error("저장에 실패했습니다. 입력 내용을 확인하세요.");
      setSaved(JSON.stringify(rows));
      setMessage("저장했습니다. 다음 크롤링부터 적용됩니다.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="keyword-panel">
      <div className="keyword-panel-heading">
        <div>
          <h2>
            성분 키워드{" "}
            <span className="keyword-count">{loaded ? rows.length : "…"}</span>
          </h2>
          <p>성분에 포함된 단어를 찾아, 원하는 이름으로 표시합니다.</p>
        </div>
      </div>
      <div className="keyword-example">
        <span>매칭 예시</span>
        <span className="keyword-example-word">피디알엔</span>
        <span className="keyword-example-arrow">→</span>
        <span className="keyword-example-result">PDRN</span>
        <span className="keyword-example-note">
          포함할 단어 중 하나만 일치해도 표시 · 영문 대소문자 무관
        </span>
      </div>
      <fieldset disabled={!loaded || busy} className="keyword-settings">
        <div className="keyword-column-head">
          <span>표시할 단어</span>
          <span>
            포함할 단어 <small>Enter 또는 쉼표로 추가</small>
          </span>
          <span />
        </div>
        <div className="keyword-rule-list">
          {rows.map((row, i) => (
            <div className="keyword-rule" key={i}>
              <label className="keyword-display">
                <span className="keyword-mobile-label">표시할 단어</span>
                <input
                  aria-label={`표시할 단어 ${i + 1}`}
                  value={row.display}
                  placeholder="예: PDRN"
                  maxLength={100}
                  onChange={(e) => edit(i, "display", e.target.value)}
                />
              </label>
              <div className="keyword-alias-cell">
                <span className="keyword-mobile-label">포함할 단어</span>
                <AliasEditor
                  index={i}
                  value={row.includes}
                  onChange={(value) => edit(i, "includes", value)}
                />
              </div>
              <button
                className="keyword-delete"
                aria-label={`${row.display || "새 키워드"} 삭제`}
                title="키워드 삭제"
                onClick={() => setRows(rows.filter((_, n) => n !== i))}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        {loaded && !rows.length && (
          <div className="keyword-empty">
            등록된 키워드가 없습니다. 키워드를 추가해 보세요.
          </div>
        )}
      </fieldset>
      <div className="keyword-savebar">
        <div>
          <span className={`keyword-save-dot ${dirty ? "is-dirty" : ""}`} />
          {dirty
            ? "저장하지 않은 변경사항이 있습니다"
            : "다음 크롤링부터 적용됩니다"}
          <span className="keyword-save-note">
            기존 수집 이력은 유지됩니다.
          </span>
        </div>
        <div className="keyword-save-actions">
          <button
            className="keyword-add"
            disabled={!loaded || busy || rows.length >= 100}
            onClick={() => setRows([...rows, { display: "", includes: "" }])}
          >
            <span aria-hidden="true">＋</span> 키워드 추가
          </button>
          <button
            className="keyword-save"
            disabled={!loaded || busy || !dirty}
            onClick={() => void save()}
          >
            {busy ? "저장 중…" : "변경사항 저장"}
          </button>
        </div>
      </div>
      {message && (
        <p className="keyword-feedback" role="status">
          {message}
        </p>
      )}
    </article>
  );
}
