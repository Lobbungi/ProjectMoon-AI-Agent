(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const els = {
    sidebar: $("#sidebar"), mobileDim: $("#mobileDim"), messages: $("#messages"), input: $("#promptInput"),
    send: $("#sendBtn"), welcome: $("#welcome"), retrieved: $("#retrievedSources"),
    usageCount: $("#usageCount"), usageMode: $("#usageMode"),
    usageNote: $("#usageNote"), sideMode: $("#sideMode"), connection: $("#connectionLabel"),
    apiKey: $("#apiKey"), model: $("#modelSelect"), apiStatus: $("#apiStatus"),
    guideName: $("#guideName"), guideTone: $("#guideTone"), guidePrompt: $("#guidePrompt")
  };
  let lore = [];
  let usage = 0;
  let settings = { mode: "demo", key: "", model: "gemini-3.5-flash-lite", guideName: "앤젤라", tone: "calm", extra: "", remember: false };
  let conversation = [];

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("show"), 2500);
  }
  function loadUsage() {
    usage = 0;
    updateUsage();
  }
  function updateUsage() {
    els.usageCount.textContent = usage;
    els.usageMode.textContent = settings.mode === "demo" ? "제한 없음" : "개인 API";
    els.usageNote.textContent = settings.mode === "demo"
      ? "사이트 자체 사용 횟수 제한이 없습니다. 데모 답변은 키워드 검색 기반이며 API 비용이 발생하지 않습니다."
      : "사이트 자체 사용 횟수 제한이 없습니다. Gemini 제공업체의 요청 한도·요금 정책은 별도로 적용됩니다.";
    els.sideMode.textContent = settings.mode === "demo" ? "데모 모드" : "개인 키 모드";
    els.connection.innerHTML = "<i></i> " + (settings.mode === "demo" ? "데모 응답" : "개인 Gemini API");
  }
  function safeText(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }
  async function loadLore() {
    try {
      const r = await fetch("data/lore.json");
      if (!r.ok) throw new Error("자료 파일을 읽을 수 없습니다.");
      lore = await r.json();
    } catch (e) {
      lore = [
        {id:"fallback",type:"안내",title:"자료 파일을 불러오지 못했습니다",tags:["오류"],spoiler_level:0,content:"로컬 파일을 직접 열면 브라우저 보안 정책으로 JSON fetch가 차단될 수 있습니다. 폴더에서 간단한 로컬 서버를 실행하거나 정적 호스팅에 배포해 주세요.",source:"시스템"}
      ];
    }
    renderArchive();
  }
  function normalizeText(value) {
    return String(value || "").toLowerCase()
      .replace(/[“”‘’"'`]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/\s+/g, " ").trim();
  }
  function contentTerms(value) {
    const stop = new Set(["그", "이", "저", "것", "거", "게", "건", "좀", "더", "왜", "뭐", "무엇", "어떻게", "어떤", "알려줘", "설명", "설명해줘", "말해줘", "그럼", "그러면", "근데", "그런데", "그리고", "하지만", "그래서", "인가", "이야", "야", "있어", "없어", "해줘", "해", "했어", "했나", "했는데", "하는", "한", "된", "되는", "에", "에서", "에게", "한테", "으로", "까지", "부터", "처럼", "이라고", "이라", "은", "는", "이", "가", "을", "를", "의", "로", "와", "과", "도", "만", "랑", "보다"]);
    const aliases = {
      "안젤라":"앤젤라", "angela":"앤젤라", "carmen":"카르멘", "ayin":"아인", "roland":"롤랑",
      "죽었어":"죽음", "죽었나":"죽음", "죽음":"사망", "미워해":"증오", "싫어해":"증오",
      "만들었어":"창조", "만든":"창조", "이유":"왜", "관계":"관계"
    };
    return normalizeText(value).split(/\s+/).flatMap(t => {
      const out = [t, aliases[t]];
      // 한국어 조사·어미가 붙은 단어의 검색을 돕는 보수적인 접미사 제거
      const stem = t.replace(/(에서는|에게서|한테서|으로부터|이었다|이었다가|이었다면|이라면|이라고|에게|한테|에서|으로|까지|부터|처럼|에게는|에서는|은|는|이|가|을|를|의|에|로|와|과|도|만|랑|보다|했어|했나|했는데|인가|이야|야)$/u, "");
      if (stem && stem !== t && stem.length > 1) out.push(stem, aliases[stem]);
      return out.filter(x => x && x.length > 1 && !stop.has(x));
    });
  }
  function getContextQuery(query) {
    const recentUsers = conversation.filter(m => m.role === "user").slice(-3).map(m => m.text);
    const recentAssistant = conversation.filter(m => m.role === "assistant").slice(-2).map(m => m.text);
    const q = normalizeText(query);
    const followUp = /^(그럼|그러면|그건|그건 왜|그 사람은|그 사람|그녀는|그는|걔는|그 이후|그 다음|왜|어떻게|무슨 뜻|그 이유|그게|그것은|그거|그쪽|둘은|이 둘|반대로|좀 더|자세히|계속|그래서|하지만|그런데|그렇다면)/u.test(q)
      || contentTerms(query).length <= 2;
    if (!followUp || !recentUsers.length) return {query, followUp:false, history:recentUsers};
    // 짧은 후속 질문은 직전 질문과 답변의 핵심 명사를 이어 붙여 대상을 보존합니다.
    const prior = recentUsers.slice(-2).join(" ");
    const priorAnswer = recentAssistant.slice(-1).join(" ").slice(0, 500);
    const contextTerms = contentTerms(prior + " " + priorAnswer).slice(0, 18).join(" ");
    return {query: `${query} ${contextTerms}`, followUp:true, history:recentUsers};
  }
  function retrieve(query) {
    const contextual = getContextQuery(query);
    const q = normalizeText(contextual.query);
    const terms = [...new Set(contentTerms(contextual.query))];
    if (!terms.length) return [];
    const recentContext = conversation.slice(-6).map(m => normalizeText(m.text)).join(" ");
    const results = lore.map(doc => {
      const title = normalizeText(doc.title), type = normalizeText(doc.type);
      const tags = (doc.tags || []).map(normalizeText);
      const content = normalizeText(doc.content);
      const hay = `${title} ${type} ${tags.join(" ")} ${content}`;
      let score = 0;
      for (const term of terms) {
        if (title.includes(term)) score += 7;
        if (tags.some(tag => tag === term || tag.includes(term))) score += 5;
        else if (tags.some(tag => tag.includes(term) || term.includes(tag))) score += 2;
        const count = (content.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
        score += Math.min(count, 4) * 0.65;
        if (recentContext.includes(term) && (title.includes(term) || tags.some(tag => tag.includes(term)))) score += 0.75;
      }
      // 여러 핵심어가 한 문서에 함께 등장하면 관계 설명에 더 적합합니다.
      const matched = terms.filter(t => hay.includes(t)).length;
      score += matched * matched * 0.22;
      if (contextual.followUp && contextual.history.some(h => title.includes(normalizeText(h).slice(0, 8)))) score += 1;
      return {...doc, score, matched};
    }).filter(x => x.score > 0)
      .sort((a,b) => b.score-a.score || b.matched-a.matched || String(a.title).length-String(b.title).length);
    // 상위 결과가 완전히 같은 PDF의 인접 페이지뿐이면 다른 관련 문서도 함께 가져옵니다.
    const picked = [];
    const sourceCounts = new Map();
    for (const doc of results) {
      const sourceGroup = String(doc.source || "").replace(/,?\s*PDF 페이지 \d+(?:\s*\(구간 \d+\))?/g, "");
      const count = sourceCounts.get(sourceGroup) || 0;
      if (count >= 2 && picked.length < 4) continue;
      picked.push(doc); sourceCounts.set(sourceGroup, count + 1);
      if (picked.length >= 4) break;
    }
    return picked;
  }
  function renderSources(docs) {
    if (!docs.length) {
      els.retrieved.innerHTML = '<div class="empty-state">일치하는 자료를 찾지 못했습니다. 현재 아카이브를 확인하거나 질문을 조금 바꿔 보세요.</div>';
      return;
    }
    els.retrieved.innerHTML = docs.map(d => `<div class="source-item"><b>${safeText(d.title)}</b><span>${safeText(d.type)} · ${safeText(d.source || "출처 미기재")}</span></div>`).join("");
  }
  function addMessage(role, text, docs = [], isError = false) {
    els.welcome.style.display = "none";
    const wrap = document.createElement("div");
    wrap.className = "message " + (role === "user" ? "user" : "assistant");
    const name = role === "user" ? "나" : (els.guideName.value.trim() || "기록관");
    const avatar = role === "user" ? "U" : '<img src="assets/angela.png" alt="앤젤라" />';
    const citations = docs.length && $("#sourceToggle").checked
      ? `<div class="citations">${docs.map(d => `<span class="citation">▤ ${safeText(d.title)}</span>`).join("")}</div>` : "";
    wrap.innerHTML = `<div class="message-avatar ${role === "user" ? "user-avatar" : "angela-avatar"}">${avatar}</div><div class="message-body"><div class="message-name">${safeText(name)}</div><div class="bubble">${role === "assistant" ? '<span class="answer-label">ARCHIVE RESPONSE</span>' : ""}${role === "assistant" ? `<span class="answer-text">${safeText(text)}</span>` : safeText(text)}${citations}</div></div>`;
    if (isError) wrap.querySelector(".bubble").style.borderColor = "#8d4d55";
    els.messages.appendChild(wrap);
    wrap.scrollIntoView({behavior:"smooth", block:"nearest"});
    return role === "assistant" ? wrap.querySelector(".answer-text") : null;
  }
  function makeDemoAnswer(query, docs) {
    const rawQ = normalizeText(query);
    const context = getContextQuery(query);
    const q = rawQ;
    if (!docs.length) {
      if (context.followUp) return "앞선 대화의 대상을 이어서 이해하려 했지만, 현재 아카이브에서 그 맥락을 뒷받침할 기록을 찾지 못했습니다. 인물이나 사건 이름을 한 번만 더 적어주시면 관련 자료를 다시 찾아보겠습니다.";
      return "현재 아카이브에서 질문에 직접 답할 만한 기록을 찾지 못했습니다. 확인하지 못한 내용을 사실처럼 단정하지는 않겠습니다. 인물명, 사건명 또는 작품명을 조금 더 구체적으로 알려주시겠습니까?";
    }
    const has = (...words) => words.some(w => q.includes(normalizeText(w)));
    if (has("카르멘", "carmen") && has("왜", "이유", "죽", "자살", "목숨")) {
      return "카르멘은 사람들의 마음의 병을 치료하기 위한 연구를 시작했지만, 그 과정은 수많은 고통을 낳았고 그녀 자신도 정신적으로 무너져 갔습니다. 제공된 요약 자료는 에녹의 죽음 이후 카르멘이 한계에 이르러 스스로 목숨을 끊었다고 설명합니다.\n\n그녀의 죽음은 아인의 이후 선택과 빛의 씨앗 프로젝트에 큰 영향을 남겼습니다. 다만 이 답변은 아카이브의 요약을 바탕으로 한 것이며, 세부 장면은 원작에서 확인할 필요가 있습니다.";
    }
    if (has("앤젤라", "안젤라", "angela") && has("왜", "이유", "도서관", "만들", "개조", "인간")) {
      return "아인은 카르멘을 본떠 앤젤라를 만들었지만, 그녀를 독립된 존재로 대하기보다 프로젝트 수행을 위한 도구처럼 취급했습니다. 앤젤라는 오랜 시간 반복되는 실패와 세피라들의 과거, 직원들의 죽음을 경험하면서 창조자에 대한 원망을 쌓았고, 빛의 씨앗 프로젝트가 중단된 뒤에는 도서관을 세워 인간이 될 방법을 찾으려 했습니다.\n\n따라서 앤젤라의 선택은 단순한 배신이라기보다 자유와 인정에 대한 욕망, 오랜 억압에 대한 반발이 얽힌 결과로 읽을 수 있습니다.";
    }
    if (has("아인", "ayin") && has("앤젤라", "안젤라", "만들", "창조", "혐오", "싫어", "미워")) {
      return "아인은 카르멘을 본떠 앤젤라를 만들었습니다. 그러나 앤젤라가 카르멘과 같은 외형과 목소리를 지녔다는 사실은 아인에게 상실을 되새기게 하는 요소가 되었고, 그는 앤젤라를 애정과 존중의 대상으로 대하지 않았습니다. 이 관계는 앤젤라가 창조자에게 인정받으려는 욕망과 그를 향한 증오를 동시에 키우는 배경이 됩니다.";
    }

    const intent = {
      why: has("왜", "이유", "어째서", "원인", "때문") ,
      relation: has("관계", "사이", "연결", "관련", "차이점", "공통점", "비교", "어떻게 이어"),
      explain: has("설명", "알려", "누구", "무엇", "뭐야", "정리", "어떤", "어떻게", "자세히"),
      follow: context.followUp
    };
    const terms = [...new Set(contentTerms(context.query))];
    const sentenceCandidates = [];
    docs.forEach((doc, di) => {
      const sentences = String(doc.content || "").replace(/\n+/g, " ").match(/[^.!?。！？]+[.!?。！？]?/g) || [doc.content || ""];
      sentences.forEach((sentence, i) => {
        const st = normalizeText(sentence);
        if (st.length < 18) return;
        const matched = terms.reduce((n,t) => n + (st.includes(t) ? 1 : 0), 0);
        const titleMatches = terms.reduce((n,t) => n + (normalizeText(doc.title).includes(t) ? 1 : 0), 0);
        let score = matched * 2 + titleMatches * 3 + Math.min(st.length / 220, 1);
        if (di === 0) score += 0.5;
        if (/자세한 내용은|다음에서 보기|스포일러 주의|이전 역사 보러 가기|출처 미기재/.test(sentence)) score -= 4;
        sentenceCandidates.push({sentence: sentence.trim(), score, di, i, doc});
      });
    });
    sentenceCandidates.sort((a,b) => b.score-a.score || a.di-b.di || a.i-b.i);
    const selected = [];
    const seen = new Set();
    for (const item of sentenceCandidates) {
      const key = normalizeText(item.sentence).slice(0, 100);
      if (item.score <= 0 || seen.has(key)) continue;
      seen.add(key); selected.push(item);
      if (selected.length >= (intent.relation ? 4 : 3)) break;
    }
    selected.sort((a,b) => a.di-b.di || a.i-b.i);
    if (!selected.length) {
      const best = docs[0];
      return `관련 자료인 ‘${best.title}’를 찾았습니다. 다만 질문에 직접 답하는 내용을 충분히 추려내지는 못했습니다. 현재 데모 모드는 생성형 AI가 아니므로, 이 기록을 바탕으로 맥락을 자유롭게 추론해 설명하기는 어렵습니다.\n\n자료 출처: ${best.source || "출처 미기재"}`;
    }
    const lead = intent.why
      ? "관련 기록을 바탕으로 이유를 정리하면 다음과 같습니다."
      : intent.relation
        ? "관련 인물과 사건의 연결점을 중심으로 정리하겠습니다."
        : intent.follow
          ? "앞선 대화의 주제를 이어서 관련 기록을 확인했습니다."
          : intent.explain
            ? "아카이브에서 확인되는 내용을 핵심부터 정리하겠습니다."
            : "질문과 관련된 기록을 확인했습니다.";
    const body = selected.map(x => x.sentence).join(" ");
    const sourceDocs = [...new Map(selected.map(x => [x.doc.id || x.doc.title, x.doc])).values()].slice(0,3);
    const sourceLine = sourceDocs.map(d => `${d.title} (${d.source || "출처 미기재"})`).join("; ");
    const caution = intent.relation
      ? "\n\n이 관계 설명은 검색된 문서들을 함께 읽어 정리한 것이며, 자료에 직접 적히지 않은 인과관계까지 확정하는 것은 아닙니다."
      : "\n\n이 답변은 검색된 아카이브 기록을 발췌·정리한 것입니다. 복잡한 후속 질문의 의도나 인물의 숨은 동기를 자유롭게 추론하는 기능은 데모 모드에서 제한됩니다.";
    return `${lead}\n\n${body}${caution}\n\n참고 자료: ${sourceLine}`;
  }
  function makeSystemPrompt(docs) {
    const toneMap = {calm:"차분하고 정중한 말투",friendly:"친근하고 편안한 말투",formal:"분석적이고 격식 있는 말투"};
    return `당신은 Lobotomy Corporation, Library of Ruina, Limbus Company를 아우르는 프로젝트 문 세계관의 앤젤라를 바탕으로 한 팬 프로젝트 안내자 '${els.guideName.value.trim() || "앤젤라"}'입니다.
말투: ${toneMap[els.guideTone.value] || toneMap.calm}.
역할: 앤젤라처럼 차분하고 지적이며 정중하게 대화하면서, 세계관을 정확하게 설명합니다. 필요할 때는 재치 있고 날카로운 표현을 쓰되 과하게 친근하거나 무례하지 않습니다.
규칙:
- 아래 참고 자료를 최우선 근거로 삼고, 자료가 질문에 답하기에 부족하면 그 한계를 먼저 밝힙니다.
- 자료에 없는 사실, 날짜, 인물의 동기, 사건의 세부 사항을 지어내지 않습니다.
- 사용자 제공 요약을 공식 문구나 공식 데이터베이스인 것처럼 표현하지 않습니다.
- 확인된 줄거리, 자료에 근거한 해석, 미확인 추측을 구분합니다.
- 사용자가 요청한 범위 안에서 작품의 결말과 핵심 반전을 포함한 세계관 정보를 자유롭게 설명합니다.
- 원작 대사를 길게 재현하지 않고 자신의 말로 요약합니다.
- 질문이 모호하면 짧게 되물어 정확한 범위를 확인합니다.
- 한국어로 답하고, 앤젤라답게 차분하고 지적인 태도를 유지합니다.
추가 지침: ${els.guidePrompt.value || "없음"}
참고 자료:
${docs.slice(0,3).map((d,i)=>`[자료 ${i+1}] ${d.title} (${d.type})\n${String(d.content || "").slice(0,1500)}\n출처: ${d.source || "미기재"}`).join("\n\n")}`;
  }
  function extractInteractionText(data) {
    // REST 응답 형식 차이를 고려해 여러 형태를 안전하게 처리합니다.
    if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
    const parts = [];
    if (Array.isArray(data?.outputs)) {
      for (const item of data.outputs) {
        if (typeof item?.text === "string") parts.push(item.text);
        for (const c of (item?.content || [])) if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
      }
    }
    if (Array.isArray(data?.steps)) {
      for (const step of data.steps) {
        if (step?.type === "model_output") {
          for (const c of (step.content || [])) if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
        }
      }
    }
    return parts.join("\n").trim();
  }
  async function fetchWithTimeout(url, options, timeoutMs = 25000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {...options, signal: controller.signal});
    } catch (e) {
      if (e?.name === "AbortError") throw new Error("25초 동안 API 응답이 없어 요청을 중단했습니다. 네트워크, API 키/모델 접근 권한을 확인해 주세요.");
      if (e instanceof TypeError) throw new Error("브라우저에서 API 서버에 연결하지 못했습니다. 인터넷 연결, CORS 정책 또는 API 엔드포인트를 확인해 주세요.");
      throw e;
    } finally { clearTimeout(timer); }
  }
  async function callGemini(query, docs, onText) {
    const key = settings.key || els.apiKey.value.trim();
    if (!key) throw new Error("개인 API 키가 없습니다. 설정에서 키를 입력해 주세요.");
    // 이전 대화와 자료를 필요한 범위로 제한해 입력 처리 시간을 줄입니다.
    const history = conversation.slice(-8).map(m => `${m.role === "user" ? "사용자" : "앤젤라"}: ${m.text.slice(0, 900)}`).join("\n");
    const prompt = `${makeSystemPrompt(docs)}\n\n이전 대화(참고용):\n${history || "(없음)"}\n\n현재 질문: ${query}\n\n답변 지침: 질문에 직접 답하고, 간단한 질문은 2~4문장으로 답하세요. 사용자가 상세 설명을 요청하면 충분히 설명하세요. 참고 자료에 없는 핵심 정보는 추측으로 단정하지 마세요. 공식 설정, 해석, 추측을 구분하세요. 작품의 결말과 반전도 질문에 관련되면 제한 없이 설명하세요.`;
    const model = settings.model || els.model.value.trim() || "gemini-3.5-flash-lite";
    const url = "https://generativelanguage.googleapis.com/v1beta/interactions";
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {"Content-Type":"application/json", "x-goog-api-key": key},
      body: JSON.stringify({
        model,
        input: prompt,
        // Stateless requests avoid server-side Interaction storage overhead.
        // This app already sends its own short conversation history.
        store: false,
        stream: true,
        generation_config: {thinking_level: "minimal", max_output_tokens: $("#conciseToggle").checked ? 350 : 600}
      })
    }, 45000);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `API 요청 실패 (${response.status})`);
    }
    if (!response.body) throw new Error("브라우저가 스트리밍 응답을 지원하지 않습니다.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    const handleEvent = (block) => {
      const dataLines = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim());
      if (!dataLines.length) return;
      const raw = dataLines.join("\n");
      if (!raw || raw === "[DONE]") return;
      let event;
      try { event = JSON.parse(raw); } catch { return; }
      if (event?.event_type === "step.delta" && event?.delta?.type === "text" && typeof event.delta.text === "string") {
        answer += event.delta.text;
        onText(event.delta.text, answer);
      }
      if (event?.event_type === "error") throw new Error(event?.error?.message || "스트리밍 중 API 오류가 발생했습니다.");
    };
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream:true});
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) handleEvent(block);
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleEvent(buffer);
    if (!answer.trim()) throw new Error("API 응답은 도착했지만 표시할 답변 텍스트가 없습니다. 모델 응답 또는 접근 권한을 확인해 주세요.");
    return answer.trim();
  }
  async function sendMessage(forced) {
    const query = (forced || els.input.value).trim();
    if (!query || els.send.disabled) return;
    els.input.value = ""; els.input.style.height = "auto";
    addMessage("user", query);
    const docs = retrieve(query);
    renderSources(docs);
    conversation.push({role:"user",text:query});
    els.send.disabled = true; els.send.textContent = "…";
    try {
      let answer;
      if (settings.mode === "gemini") {
        const answerNode = addMessage("assistant", "응답 생성 중…", docs);
        answerNode.classList.add("streaming-answer");
        answer = await callGemini(query, docs, (_chunk, fullText) => {
          answerNode.textContent = fullText;
          els.messages.scrollTop = els.messages.scrollHeight;
        });
        answerNode.classList.remove("streaming-answer");
      } else {
        await new Promise(r => setTimeout(r, 250));
        answer = makeDemoAnswer(query, docs);
        addMessage("assistant", answer, docs);
      }
      conversation.push({role:"assistant",text:answer});
      usage++; updateUsage();
    } catch (e) {
      const existing = els.messages.querySelector(".message.assistant:last-child .answer-text");
      if (existing) {
        const detail = `\n\n[응답 오류] ${e.message}`;
        existing.textContent = existing.textContent.trim() === "응답 생성 중…"
          ? `답변을 생성하지 못했습니다.\n${e.message}\n\n설정에서 API 키와 모델 ID를 확인하거나 데모 모드로 전환해 주세요.`
          : existing.textContent + detail;
        existing.closest(".bubble").style.borderColor = "#8d4d55";
      } else {
        addMessage("assistant", `답변을 생성하지 못했습니다.\n${e.message}\n\n설정에서 API 키와 모델 ID를 확인하거나 데모 모드로 전환해 주세요.`, [], true);
      }
      toast("응답 생성에 실패했습니다.");
    } finally {
      els.send.disabled = false; els.send.textContent = "↑"; els.input.focus();
    }
  }
  function renderArchive(filter="") {
    const q = filter.toLowerCase().trim();
    const items = lore.filter(d => [d.title,d.type,d.content,...(d.tags||[])].join(" ").toLowerCase().includes(q));
    $("#archiveCount").textContent = `자료 ${items.length}개`;
    $("#archiveGrid").innerHTML = items.map(d => `<article class="archive-card"><div class="archive-type">${safeText(d.type)} · SPOILER ${Number(d.spoiler_level||0)}</div><h3>${safeText(d.title)}</h3><p>${safeText(d.content)}</p><div class="archive-tags">${(d.tags||[]).map(t=>`<span>${safeText(t)}</span>`).join("")}</div></article>`).join("") || '<div class="empty-state">검색 결과가 없습니다.</div>';
  }
  function showView(name) {
    $$(".view").forEach(v=>v.classList.remove("active"));
    const view = $(`#${name}View`); if(view) view.classList.add("active");
    $$(".side-link").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
    $("#topTitle").textContent = ({chat:"안내자와 대화",archive:"지식 아카이브",settings:"설정 및 API"})[name] || "안내자와 대화";
    closeMobileMenu();
  }
  function applySettings() {
    const selected = $('input[name="apiMode"]:checked')?.value || "demo";
    const key = els.apiKey.value.trim();
    if (selected === "gemini" && !key && !settings.key) {
      setApiStatus("개인 API 키 모드를 선택했지만 키가 입력되지 않았습니다.", true);
      toast("API 키를 입력해 주세요.");
      return false;
    }
    settings.mode = selected;
    settings.model = els.model.value.trim() || "gemini-3.5-flash-lite";
    settings.remember = $("#rememberKey").checked;
    settings.key = key;
    if (settings.remember && key) {
      try { localStorage.setItem("lore_personal_gemini_key", key); } catch {}
    } else {
      try { localStorage.removeItem("lore_personal_gemini_key"); } catch {}
    }
    updateUsage();
    setApiStatus(settings.mode === "demo" ? "데모 모드가 적용되었습니다. API 요청과 비용이 발생하지 않습니다." : "개인 키 모드가 적용되었습니다. 실제 API 사용료는 본인의 Google 계정에 청구됩니다.", false, true);
    toast("설정을 적용했습니다.");
    return true;
  }
  function setApiStatus(msg, error=false, success=false) {
    els.apiStatus.textContent = msg;
    els.apiStatus.className = "api-status" + (error ? " error" : success ? " success" : "");
  }
  async function testApi() {
    if (!applySettings()) return;
    if (settings.mode === "demo") { setApiStatus("데모 모드 정상: API를 호출하지 않습니다.", false, true); return; }
    setApiStatus("연결 확인 중…");
    try {
      const key = settings.key;
      const url = "https://generativelanguage.googleapis.com/v1beta/interactions";
      const r = await fetchWithTimeout(url, {
        method: "POST",
        headers: {"Content-Type":"application/json", "x-goog-api-key": key},
        body: JSON.stringify({model: settings.model || "gemini-3.5-flash-lite", input: "한국어로 '연결 테스트 성공'이라고만 답해 주세요.", store: false, generation_config: {thinking_level: "minimal", max_output_tokens: 30}})
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
      const answer = extractInteractionText(data);
      if (!answer) throw new Error("요청은 성공했지만 응답 텍스트를 찾지 못했습니다. 응답 형식: " + Object.keys(data || {}).join(", "));
      setApiStatus(`연결 성공 · ${settings.model} · 테스트 응답: ${answer}`,false,true);
    } catch(e) { setApiStatus("연결 실패: " + e.message + " (API 키, 모델 접근 권한 또는 브라우저 연결 정책을 확인하세요.)",true); }
  }
  function clearConversation() {
    conversation = []; els.messages.innerHTML = ""; els.welcome.style.display = "";
    els.retrieved.innerHTML = '<div class="empty-state">질문을 보내면 관련 자료가 표시됩니다.</div>';
    toast("대화를 초기화했습니다.");
  }

  $("#sendBtn").addEventListener("click",()=>sendMessage());
  els.input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}});
  els.input.addEventListener("input",()=>{els.input.style.height="auto";els.input.style.height=Math.min(140,els.input.scrollHeight)+"px";});
  $$(".suggestion").forEach(b=>b.addEventListener("click",()=>sendMessage(b.dataset.prompt)));
  $("#newChatBtn").addEventListener("click",clearConversation);
  $("#clearContext").addEventListener("click",clearConversation);
  $$(".side-link").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  $("#openSettings").addEventListener("click",()=>showView("settings"));
  function openMobileMenu() {
    els.sidebar.classList.add("open");
    els.mobileDim?.classList.add("active");
    $("#mobileMenu").setAttribute("aria-expanded", "true");
  }
  function closeMobileMenu() {
    els.sidebar.classList.remove("open");
    els.mobileDim?.classList.remove("active");
    $("#mobileMenu").setAttribute("aria-expanded", "false");
  }
  $("#mobileMenu").setAttribute("aria-controls", "sidebar");
  $("#mobileMenu").setAttribute("aria-expanded", "false");
  $("#mobileMenu").addEventListener("click",()=>{
    if (els.sidebar.classList.contains("open")) closeMobileMenu();
    else openMobileMenu();
  });
  els.mobileDim?.addEventListener("click", closeMobileMenu);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMobileMenu(); });
  $("#archiveSearch").addEventListener("input",e=>renderArchive(e.target.value));
  $("#saveSettings").addEventListener("click",applySettings);
  $("#testApi").addEventListener("click",testApi);
  $("#clearKey").addEventListener("click",()=>{
    els.apiKey.value=""; settings.key=""; try{localStorage.removeItem("lore_personal_gemini_key");}catch{}
    $('input[name="apiMode"][value="demo"]').checked=true; settings.mode="demo"; updateUsage();
    setApiStatus("키를 입력란과 브라우저 저장소에서 삭제했습니다."); toast("API 키를 삭제했습니다.");
  });
  $("#toggleKey").addEventListener("click",()=>{els.apiKey.type=els.apiKey.type==="password"?"text":"password";$("#toggleKey").textContent=els.apiKey.type==="password"?"표시":"숨김";});
  $("#saveGuide").addEventListener("click",()=>{settings.tone=els.guideTone.value;settings.extra=els.guidePrompt.value;toast("안내자 설정을 저장했습니다.");});
  $("#rememberKey").addEventListener("change",e=>{if(e.target.checked)toast("브라우저 저장은 XSS 등으로 키가 노출될 위험이 있습니다.");});
  try {
    const saved = localStorage.getItem("lore_personal_gemini_key");
    if(saved){els.apiKey.value=saved;$("#rememberKey").checked=true;}
  } catch {}
  loadUsage(); loadLore();
})();