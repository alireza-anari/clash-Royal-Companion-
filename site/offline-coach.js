/* Evidence-based offline battle coach. No AI API or data upload. */
(function(root) {
  "use strict";

  function item(title, detail) {
    return {title, detail};
  }

  function analyze(rawBattles, playerTag, scope, selectedDeck) {
    if (!Array.isArray(rawBattles) || rawBattles.length === 0) {
      return {items: [item(
        "هنوز داده نبرد نداریم",
        "از صفحه نبردها فایل Battle Log را وارد کن. تحلیل فقط در مرورگر انجام می‌شود."
      )]};
    }

    const engine = root.CRCBattleIntelligence;
    if (!engine) {
      return {items: [item("ماژول در دسترس نیست", "موتور تحلیل نبرد بارگذاری نشده است.")]};
    }

    const tag = engine.tag(playerTag);
    if (!tag) {
      return {items: [item(
        "Player Tag لازم است",
        "برای انتساب معتبر نتایج، ابتدا Player Tag را در صفحه پروفایل وارد کن."
      )]};
    }

    const mode = scope === "event" ? "event"
      : scope === "other" ? "other" : "all";
    const scopeLabel = mode === "event" ? "رویدادی"
      : mode === "other" ? "سایر / نامشخص" : "همه";
    const report = engine.summarize(rawBattles, tag, mode);
    const matched = report.entries.filter(e => e.attribution === "matched_tag");
    const unmatched = report.entries.length - matched.length;
    const fmt = n => new Intl.NumberFormat("fa-IR", {
      maximumFractionDigits: 2
    }).format(n);

    const items = [item(
      "پوشش شواهد (" + scopeLabel + ")",
      `از ${fmt(report.entries.length)} نبرد، ${fmt(matched.length)} مورد با Player Tag تطبیق دارد. ${fmt(unmatched)} مورد برای این بازیکن قابل انتساب نیست.`
    )];

    if (!matched.length) {
      items.push(item(
        "تحلیل نتیجه ممکن نیست",
        "هیچ نتیجه‌ای را به بازیکن نسبت نمی‌دهیم. Tag و فایل واردشده را بررسی کن."
      ));
      return {items};
    }

    for (const [kind, label] of [
      ["event", "نبردهای رویدادی"],
      ["unclassified", "نبردهای با حالت تأییدنشده"]
    ]) {
      const group = matched.filter(e => e.classification === kind);
      if (!group.length) continue;
      const count = outcome => group.filter(e => e.outcome === outcome).length;
      items.push(item(
        label,
        `${fmt(group.length)} نبرد: ${fmt(count("win"))} برد، ${fmt(count("loss"))} شکست، ${fmt(count("draw"))} مساوی و ${fmt(count("unknown"))} نتیجه نامشخص. این فقط خلاصه همین نمونه است.`
      ));
    }


    // Compare only the eight main cards; tower troop may be unknown.
    if (
      Array.isArray(selectedDeck) &&
      selectedDeck.length === 8 &&
      selectedDeck.every(Number.isSafeInteger) &&
      new Set(selectedDeck).size === 8
    ) {
      const selectedKey = selectedDeck.slice().sort((a,b)=>a-b).join(":");
      const observed = matched.filter(e =>
        e.deck &&
        e.deck.card_ids.slice().sort((a,b)=>a-b).join(":") === selectedKey
      );

      if (!observed.length) {
        items.push(item(
          "دک انتخاب‌شده در این نمونه دیده نشد",
          "از نبود این دک در فایل نمی‌توان نتیجه گرفت که قبلاً استفاده نشده است."
        ));
      } else {
        for (const [kind, label] of [
          ["event", "رویدادی"],
          ["unclassified", "حالت تأییدنشده"]
        ]) {
          const group = observed.filter(e => e.classification === kind);
          if (!group.length) continue;
          const count = result => group.filter(e => e.outcome === result).length;
          items.push(item(
            "دک انتخاب‌شده — " + label,
            `${fmt(group.length)} استفاده ثبت‌شده؛ ` +
            `${fmt(count("win"))} برد، ` +
            `${fmt(count("loss"))} شکست و ` +
            `${fmt(count("unknown"))} نتیجه نامشخص. ` +
            "تطبیق فقط بر اساس هشت کارت اصلی است؛ Tower Troop و وضعیت ویژه کارت‌ها ممکن است متفاوت باشند."
          ));
        }
      }
    }

    const decks = new Map();
    for (const entry of matched) {
      if (!entry.deck) continue;
      const key = entry.classification + "|" + entry.deck.key;
      decks.set(key, (decks.get(key) || 0) + 1);
    }
    const mostRepeated = Math.max(0, ...decks.values());
    if (mostRepeated >= 2) {
      items.push(item(
        "ترکیب تکرارشده",
        `یک ترکیب یکسان در ${fmt(mostRepeated)} نبرد با حالت یکسان ثبت شده است. این مشاهده به معنی بهترین بودن آن دک نیست.`
      ));
    }

    const leaks = matched.map(e => e.elixir_leaked)
      .filter(x => typeof x === "number" && Number.isFinite(x) && x >= 0);
    if (leaks.length) {
      const average = leaks.reduce((a, b) => a + b, 0) / leaks.length;
      items.push(item(
        "Elixir Leaked گزارش‌شده",
        `میانگین ${fmt(average)} در ${fmt(leaks.length)} نبرد دارای داده. بدون Replay نمی‌توان زمان یا علت این مقدار را تشخیص داد.`
      ));
    }

    if (matched.length < 3) {
      items.push(item(
        "محدودیت نمونه",
        "تعداد نبردهای قابل انتساب کم است؛ از نتیجه‌گیری درباره عملکرد کلی بازیکن خودداری می‌کنیم."
      ));
    }

    items.push(item(
      "گام بعدی مربی",
      "برای پیشنهاد تاکتیکی درباره زمان‌بندی، جای‌گذاری کارت و تصمیم‌های داخل مسابقه، شواهد Replay یا داده رویدادهای واقعی لازم است."
    ));

    return {items};
  }

  root.CRCOfflineCoach = Object.freeze({analyze});
})(typeof window !== "undefined" ? window : globalThis);
