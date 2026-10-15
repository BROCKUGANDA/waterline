"use client";

// WATERLINE — Arabic mirror of the activity feed copy. The server renders
// canonical English title/detail; this module renders the designed Arabic
// mirror from the same structured facts (PRD 11.1: Arabic is a mirror, not a
// translation layer — copy is written for the language, tone preserved).
// Money is formatted from integer fils only; every field is read defensively
// so a corrupt payload falls back to the server copy, never breaks the feed.

import { formatAedAr } from "@/lib/money";
import type { ActivityEventDto } from "@/lib/types";

const VIA_LABELS_AR: Record<string, string> = {
  einvoice: "سجل الفاتورة الإلكترونية",
  buyer_api: "واجهة المشتري",
  buyer_portal: "بوابة المشتري",
  du_ap: "ملف ذمم دو",
};

export interface EventCopy {
  title: string;
  detail: string;
}

export function renderActivityEventAr(ev: ActivityEventDto): EventCopy {
  const p = ev.params?.payload ?? {};
  const num = (k: string): number | null =>
    typeof p[k] === "number" && Number.isFinite(p[k] as number) ? (p[k] as number) : null;
  const aed = (k: string): string | null => {
    const v = num(k);
    return v === null ? null : formatAedAr(v);
  };
  const str = (k: string): string | null => (typeof p[k] === "string" ? (p[k] as string) : null);
  const ref = (): string => ev.params?.ref || "";
  const milestone = (): string => ev.params?.milestone || str("milestone") || "المرحلة";
  const OUTCOME_AR: Record<string, string> = {
    approved: "مقبول",
    rejected: "مرفوض",
    capped: "محدوداً بسقف",
  };

  switch (ev.type) {
    case "onboarding.completed":
      return {
        title: "اكتمل التسجيل",
        detail: "حُدِّد الحد الاسترشادي من سجل فوترة دو — قبل رفع أي فاتورة.",
      };
    case "invoice.submitted":
      return { title: "أُرسلت فاتورة", detail: `${ref()} أُرسلت للتحقق.` };
    case "invoice.verified":
      return {
        title: "تم تأكيد الفاتورة",
        detail: `${ref()} تأكدت عبر ${VIA_LABELS_AR[str("via") ?? ""] ?? "تأكيد المشتري"}.`,
      };
    case "invoice.disputed":
      return {
        title: "فاتورة متنازع عليها",
        detail: `${ref()} نازع عليها المشتري — التمويل موقوف حتى الحل.`,
      };
    case "invoice.settled":
      return {
        title: "سُدِّدت الفاتورة",
        detail: `${ref()} سُدِّدت — دفع المشتري ${aed("grossFils") ?? "قيمة الفاتورة كاملة"}.`,
      };
    case "decision.recorded": {
      const limit = num("limitFils");
      const outcome = str("outcome");
      const OUTCOME_AR: Record<string, string> = { approved: "مقبول", rejected: "مرفوض", capped: "محدوداً بسقف" };
      return {
        title: "حُسِب سعر",
        detail: `${ref()} — ${str("reasonText") ?? (limit !== null ? `${formatAedAr(limit)} بالسعر الحتمي لحزمة القواعد` : `النتيجة ${OUTCOME_AR[outcome ?? ""] ?? outcome ?? "مُسجّلة"}`)}.`,
      };
    }
    case "decision.replayed":
      return {
        title: "أُعيد تشغيل القرار",
        detail:
          p["matchesOriginal"] === false
            ? "انحرفت الإعادة عن النتيجة الأصلية — يُرسب هذا البناء ويُمنع الترويج."
            : "طابقت الإعادة النتيجة الأصلية حرفياً (اختبار الانحدار الليلي).",
      };
    case "offer.accepted":
      return {
        title: "قُبل الدفع المبكر",
        detail: `${aed("netProceedsFils") ?? formatAedAr(num("principalFils") ?? 0)} صافياً إلى دو باي — ${num("daysEarly") ?? "؟"} يوماً مبكراً، الرسوم ${aed("feeFils") ?? "٠"}.`,
      };
    case "payout.initiated":
      return {
        title: "بدأت الدفعة",
        detail: `${aed("amountFils") ?? "الدفعة"} أُرسلت إلى دو باي عبر قناة ${str("rail") ?? "dupay"} — أربع مراحل، توقيت صادق.`,
      };
    case "payout.queued":
      return {
        title: "دفعة في الانتظار",
        detail: `${aed("amountFils") ?? "الدفعة"} قُبلت بالسعر المقتبس — قناة الدفع غير متاحة، لذا يتحرك المال فور عودتها. لا شيء لإعادة فعله.`,
      };
    case "payout.released":
      return {
        title: "أُطلقت الدفعة المنتظرة",
        detail: `عادت قناة الدفع — ${aed("amountFils") ?? "الدفعة"} تتحرك الآن بالسعر الذي قبلته.`,
      };
    case "payout.state_changed": {
      const to = str("to") ?? str("stage") ?? "";
      if (to === "reserved") {
        return { title: "حُجِزت الدفعة", detail: "حُجز مصدر التمويل للتحويل." };
      }
      if (to === "sent") {
        return {
          title: "أُرسل المال إلى دو باي",
          detail: `${aed("amountFils") ?? "الدفعة"} فُوضت${str("providerRef") ? ` — مرجع ${str("providerRef")}` : ""}.`,
        };
      }
      if (to === "settled") {
        return {
          title: "سُدِّد المال إلى دو باي",
          detail: `${aed("amountFils") ?? "الدفعة"} سُدِّدت — تسوية يومية إلى الدرهم.`,
        };
      }
      return {
        title: "تحديث الدفعة",
        detail: `انتقلت المرحلة من ${str("from") ?? "؟"} إلى ${to || "المرحلة التالية"}.`,
      };
    }
    case "payout.settled":
      return { title: "سُدِّد المال إلى دو باي", detail: `${aed("amountFils") ?? "الدفعة"} سُدِّدت إلى المحفظة.` };
    case "payout.failed":
      return {
        title: "فشلت الدفعة",
        detail: "فشل التحويل بشكل نظيف — عُوّض القيد المحاسبي وأُعيد إكرام السعر الأصلي.",
      };
    case "escrow.awarded":
      return {
        title: "مُوّل الضمان",
        detail: `${str("buyerName") ?? "المشتري"} موّل ${aed("totalFils") ?? "قيمة العقد"} لدى الوصي — الأموال محجوزة قبل بدء العمل.`,
      };
    case "escrow.condition_met":
      return {
        title: "سُلِّمت مرحلة",
        detail: `${milestone()} أُشِّرت مسلَّمة${str("evidence") ? ` — الدليل ${str("evidence")}` : ""}. نافذة مراجعة المشتري مفتوحة الآن.`,
      };
    case "escrow.released":
      return {
        title: "أُفرج عن مرحلة",
        detail: `${aed("amountFils") ?? "قيمة المرحلة"} أُفرج عنها إلى المحفظة — ${milestone()}.`,
      };
    case "escrow.disputed":
      return {
        title: "مرحلة متنازع عليها",
        detail: `${milestone()} مجمّدة${str("reason") ? ` (${str("reason")})` : ""} — المراحل غير المتنازع عليها تستمر.`,
      };
    case "escrow.completed":
      return {
        title: "اكتمل الضمان",
        detail: `أُفرج عن جميع المراحل — ${ev.params?.description ?? str("description") ?? "العقد"} (${aed("totalFils") ?? formatAedAr(0)}).`,
      };
    case "sweep.executed":
      return {
        title: "نُفِّذ توظيف خزاني",
        detail: `${aed("amountFils") ?? "الفائض"} إلى ${str("instrumentName") ?? str("instrumentRef") ?? "أداة"} — حُمي الحد الأدنى.`,
      };
    case "sweep.recalled":
      return {
        title: "استُرجع توظيف خزاني",
        detail: `${aed("totalFils") ?? aed("amountFils") ?? "المركز"} عاد إلى المحفظة${num("yieldFils") ? ` شاملاً ${formatAedAr(num("yieldFils")!)} عائداً` : ""}.`,
      };
    case "treasury.policy_updated": {
      const floor = num("floorFils");
      const horizon = num("horizonDays");
      const margin = num("safetyMarginPermyriad");
      const parts: string[] = [];
      if (floor !== null) parts.push(`الحد الأدنى ${formatAedAr(floor)}`);
      if (horizon !== null) parts.push(`الأفق ${horizon} يوماً`);
      if (margin !== null) parts.push(`هامش الأمان ${(margin / 100).toFixed(1)}٪`);
      return {
        title: "حُدِّثت سياسة الخزانة",
        detail: parts.length > 0 ? `${parts.join("، ")} — الحد الأدنى إيقاف صارم مطلق.` : "حُدِّثت سياسة الخزانة.",
      };
    }
    case "treasury.obligation_added": {
      const due = str("dueDate");
      const dueLabel = due
        ? new Date(due).toLocaleDateString("ar-AE", { day: "numeric", month: "short" })
        : "قريباً";
      return {
        title: "أُضيف التزام",
        detail: `${str("label") ?? "التزام يدوي"} — ${aed("amountFils") ?? "مبلغ"} يُستحق ${dueLabel}.`,
      };
    }
    case "status.changed": {
      const mode = str("mode") ?? "M0";
      const automatic = p.automatic === true;
      return {
        title: "تغيّرت حالة النظام",
        detail: `الوضع ${mode}${str("message") ? ` — ${str("message")}` : ""}${str("reason") ? ` (${str("reason")})` : ""}.${automatic ? " طُبّق آلياً عبر الحواجز الوقائية — دون انتظار إنسان." : ""}`,
      };
    }
    case "guardrail.triggered": {
      const unit = str("unit") ?? "permyriad";
      const isRail = str("guardrail") === "railBreaker";
      const fmtValue = (v: number | null) =>
        v === null ? null : unit === "permyriad" ? `٪${(v / 100).toFixed(0)}` : unit === "fils" ? formatAedAr(v) : isRail ? (v >= 1 ? "مفتوح" : "مغلق") : String(v);
      const valueLabel = fmtValue(num("value"));
      const bandLabel = unit === "permyriad" ? `٪${((num("band") ?? 0) / 100) | 0}` : unit === "fils" ? "≥ ٠" : isRail ? "مغلق" : "٠";
      const m2 = str("mode") === "M2";
      return {
        title: "عُبِر حاجز وقائي",
        detail: m2
          ? `${str("guardrail") ?? "حاجز وقائي"} تجاوز نطاق التحذير (${valueLabel ?? "—"} مقابل ${bandLabel ?? "—"}) — طُبّق الوضع M2 آلياً؛ تُحترم العروض بالسعر المقفل وتنتظر القبولات في الطابور ولا تتحرك أي أموال.`
          : `${str("guardrail") ?? "حاجز وقائي"} تجاوز نطاق التحذير (${valueLabel ?? "—"} مقابل ${bandLabel ?? "—"}) — طُبّق الوضع الحذر M1 آلياً؛ تُشدَّد الحدود والسعر لا يتغير.`,
      };
    }
    case "invoice.dispute_resolved":
      return {
        title: "حُلّ نزاع فاتورة",
        detail: `${ref()} أعاد المشتري تأكيدها — استُعيد التحقق ويمكن استئناف التمويل.`,
      };
    case "consent.granted":
      return {
        title: "مُنحت موافقة",
        detail: `${str("purpose") ?? "موافقة"} مُنحت — محددة النطاق، غرض واحد لكل مفتاح.`,
      };
    case "consent.revoked":
      return {
        title: "سُحبت موافقة",
        detail: `${str("purpose") ?? "موافقة"} سُحبت — الميزات المعتمدة تتعطل خلال ٦٠ ثانية.`,
      };
    case "reserve.released": {
      const reserve = aed("amountFils") ?? aed("reserveFils");
      return {
        title: "أُفرج عن الاحتياطي",
        detail: `${reserve ?? "الاحتياطي"} أُفرج عنه إلى المحفظة${ref() ? ` — ${ref()}` : ""}.`,
      };
    }
    case "fraud.review":
      return {
        title: "فاتورة مكررة قيد المراجعة",
        detail: "ظهرت بصمة الفاتورة نفسها عبر مستأجرين — النسختان مجمّدتان ومحالتان للمراجعة. لا رفض آلي أبداً.",
      };
    case "ledger.opened":
      return {
        title: "فُتح السجل المحاسبي",
        detail: "قُيّدت الأرصدة الافتتاحية — كل رصيد بعدها مشتق، لا يُخزَّن كحقيقة.",
      };
    case "advisor.qa": {
      const q = str("question");
      return {
        title: "سؤال للمرشد",
        detail: q ? `«${q}» — أُجيب من الأرقام الحية؛ حزمة القواعد تقرر والمرشد يشرح.` : "أُجيب من الأرقام الحية؛ حزمة القواعد تقرر والمرشد يشرح.",
      };
    }
    default:
      return { title: ev.title, detail: ev.detail };
  }
}
