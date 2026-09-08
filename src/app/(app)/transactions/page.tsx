import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { manualTransaction, portfolioSnapshot, security } from "@/db/schema";
import { todayInSeoul } from "@/lib/dates";
import { mul, toDecimal } from "@/lib/money";
import { formatMoneyAbs, formatQuantity } from "@/lib/format";
import { SegmentedFilter } from "@/components/SegmentedFilter";
import { TransactionsClient, type SecurityOption, type TransactionKind, type TxnRowView } from "./TransactionsClient";

type StatusFilter = "active" | "superseded" | "voided";

// Never statically prerendered — the transaction log reflects live DB state.
export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; securityId?: string; kind?: string }>;
}) {
  const sp = await searchParams;
  const status: StatusFilter = sp.status === "superseded" || sp.status === "voided" ? sp.status : "active";
  const prefillSecurityId = sp.securityId ? Number(sp.securityId) : null;
  const prefillKind: TransactionKind | undefined =
    sp.kind === "buy" || sp.kind === "sell" || sp.kind === "set_quantity" || sp.kind === "remove" ? sp.kind : undefined;

  const [allTransactions, allSecurities] = await Promise.all([
    db.select().from(manualTransaction).orderBy(desc(manualTransaction.transactionDate)),
    db.select().from(security),
  ]);

  const securityById = new Map(allSecurities.map((s) => [s.id, s]));

  const referencedSnapshotIds = [
    ...new Set(allTransactions.map((t) => t.supersededBySnapshotId).filter((id): id is number => id !== null)),
  ];
  const referencedSnapshots =
    referencedSnapshotIds.length > 0
      ? await db.select().from(portfolioSnapshot).where(inArray(portfolioSnapshot.id, referencedSnapshotIds))
      : [];
  const snapshotAsOfById = new Map(referencedSnapshots.map((s) => [s.id, s.asOfDate]));

  const filtered = allTransactions.filter((t) => {
    if (status === "voided") return t.voidedAt !== null;
    if (status === "superseded") return t.voidedAt === null && t.supersededBySnapshotId !== null;
    return t.voidedAt === null && t.supersededBySnapshotId === null;
  });

  const rows: TxnRowView[] = filtered.map((t) => {
    const sec = securityById.get(t.securityId);
    const label = sec ? (sec.market === "US" ? sec.symbol : sec.nameLocal) : `#${t.securityId}`;
    const isUsSecurity = sec?.market === "US";
    const currency = sec?.currency ?? t.currency;

    let calcLine: string;
    if (t.kind === "buy" || t.kind === "sell") {
      const amount = t.quantity && t.price ? mul(toDecimal(t.quantity), toDecimal(t.price)) : null;
      calcLine = `${t.quantity ? formatQuantity(t.quantity) : "?"}주 × ${t.price ? formatMoneyAbs(t.price, currency) : "?"}${
        amount ? ` = ${formatMoneyAbs(amount, currency)}` : ""
      }`;
    } else if (t.kind === "set_quantity") {
      calcLine = `수량을 ${t.quantity ? formatQuantity(t.quantity) : "?"}주로 지정`;
    } else {
      calcLine = "보유 제거 (수량 0으로 지정)";
    }

    return {
      id: t.id,
      securityId: t.securityId,
      securityLabel: label,
      isUsSecurity: Boolean(isUsSecurity),
      kind: t.kind,
      calcLine,
      transactionDate: t.transactionDate,
      status: t.voidedAt !== null ? "voided" : t.supersededBySnapshotId !== null ? "superseded" : "active",
      supersededAsOfDate: t.supersededBySnapshotId !== null ? (snapshotAsOfById.get(t.supersededBySnapshotId) ?? null) : null,
      voidedAtCompact: t.voidedAt ? t.voidedAt.toISOString().slice(0, 10) : null,
      quantity: t.quantity,
      price: t.price,
      currency,
    };
  });

  const securityOptions: SecurityOption[] = allSecurities
    .map((s) => ({
      id: s.id,
      label: s.market === "US" ? s.symbol : `${s.nameLocal} (${s.symbol})`,
      currency: s.currency,
      market: s.market,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <header className="appbar">
        <h1>거래 내역</h1>
      </header>
      <main className="viewport">
        <SegmentedFilter
          paramName="status"
          ariaLabel="거래 상태 필터"
          defaultValue="active"
          options={[
            { value: "active", label: "활성" },
            { value: "superseded", label: "대체됨" },
            { value: "voided", label: "취소됨" },
          ]}
        />
        <TransactionsClient
          rows={rows}
          securities={securityOptions}
          todayIso={todayInSeoul()}
          prefillSecurityId={prefillSecurityId}
          prefillKind={prefillKind}
          statusFilter={status}
        />
      </main>
    </>
  );
}
