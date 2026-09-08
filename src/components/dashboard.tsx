'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  GitBranch,
  Layers3,
  Loader2,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Truck,
  X,
  Zap,
} from 'lucide-react';
import {
  DESTINATIONS,
  PRODUCTS,
  WAREHOUSES,
  type Dashboard as DashboardData,
  type Decision,
  type Order,
  type WarehouseId,
} from '@/lib/model';
import { graphql, loadDashboard, previewOrder, routeOrder } from '@/lib/client';

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const label = (status: string) =>
  ({
    PENDING: 'Awaiting routing',
    ALLOCATED: 'Allocated',
    REVIEW: 'Needs review',
    CANCELLED: 'Cancelled',
  })[status] ?? status;
type Tab = 'orders' | 'inventory' | 'activity' | 'guide';

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [tab, setTab] = useState<Tab>('orders');
  const [selectedId, setSelectedId] = useState('FR-1042');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [overrideWarehouse, setOverrideWarehouse] = useState<WarehouseId>('BUF');
  const [overrideReason, setOverrideReason] = useState('');
  const createDialog = useRef<HTMLDialogElement>(null);
  const overrideDialog = useRef<HTMLDialogElement>(null);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const selected = data?.orders.find((o) => o.id === selectedId);
  const refresh = useCallback(async () => {
    const result = await loadDashboard();
    setData(result.dashboard);
  }, []);
  useEffect(() => {
    refresh().catch((error) => setNotice({ text: error.message, error: true }));
  }, [refresh]);
  useEffect(() => {
    let active = true;
    setDecision(null);
    if (!selected) return;
    if (selected.decision) {
      setDecision(selected.decision);
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    previewOrder(selected.id)
      .then((result) => {
        if (active) setDecision(result.evaluateOrder);
      })
      .catch((error) => {
        if (active) setNotice({ text: error.message, error: true });
      })
      .finally(() => {
        if (active) setPreviewing(false);
      });
    return () => {
      active = false;
    };
  }, [selected]);

  async function act(work: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await work();
      await refresh();
      if (message) setNotice({ text: message, error: false });
      return result;
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : 'Something went wrong.',
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }
  const allocated = data?.orders.filter((o) => o.status === 'ALLOCATED') ?? [];
  const pending = data?.orders.filter((o) => o.status === 'PENDING') ?? [];
  const review = data?.orders.filter((o) => o.status === 'REVIEW') ?? [];
  const shipping = allocated.reduce(
    (sum, o) =>
      sum + (o.decision?.candidates.find((c) => c.warehouseId === o.warehouseId)?.costCents ?? 0),
    0,
  );
  const savings = allocated.reduce((sum, o) => sum + (o.decision?.savingsCents ?? 0), 0);
  const visible =
    data?.orders.filter(
      (o) =>
        (filter === 'ALL' || o.status === filter) &&
        `${o.id} ${o.customer} ${DESTINATIONS[o.destinationId].city}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Dispatch home">
          <span className="brandmark">
            <GitBranch size={22} />
          </span>
          dispatch<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">
          <span className="avatar">GM</span>
          <div>
            Grant’s workspace<small>Fulfillment operations</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(
            [
              { id: 'orders', icon: Layers3, name: 'Order routing' },
              { id: 'inventory', icon: Boxes, name: 'Inventory' },
              { id: 'activity', icon: Clock3, name: 'Activity log' },
              { id: 'guide', icon: CircleHelp, name: 'Demo walkthrough' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <item.icon size={18} />
              {item.name}
              {item.id === 'orders' && (
                <span className="nav-count">{data?.orders.length ?? '—'}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-card">
            <span className="live-dot" /> DEMO ENVIRONMENT
            <p>
              Real routing logic.
              <br />
              Fictional orders and rates.
            </p>
            <button onClick={() => setTab('guide')}>
              Explore the scenarios <ArrowUpRight size={14} />
            </button>
          </div>
          <a
            href="https://github.com/grantmaye/Fulfillment-Routing-Engine"
            target="_blank"
            rel="noreferrer"
          >
            View source <ArrowUpRight size={14} />
          </a>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            Workspace <ChevronRight size={14} />
            <strong>
              {
                {
                  orders: 'Order routing',
                  inventory: 'Inventory',
                  activity: 'Activity log',
                  guide: 'Demo walkthrough',
                }[tab]
              }
            </strong>
          </div>
          <span className="storage">
            <span className="live-dot" />
            {data?.storageMode ?? 'Connecting'}
          </span>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">FULFILLMENT CONTROL</div>
              <h1>
                {
                  {
                    orders: 'Every order. The right warehouse.',
                    inventory: 'Stock, without the guesswork.',
                    activity: 'A record of every decision.',
                    guide: 'Take the engine for a spin.',
                  }[tab]
                }
              </h1>
              <p>
                {
                  {
                    orders: 'Compare availability and shipping. Route with confidence.',
                    inventory: 'Available inventory accounts for every active reservation.',
                    activity: 'Allocation, overrides, and stock release in one place.',
                    guide: 'Six scenarios. Two warehouses. One transparent routing policy.',
                  }[tab]
                }
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button secondary"
                disabled={busy || !data}
                onClick={() => resetDialog.current?.showModal()}
              >
                <RotateCcw size={15} />
                Reset demo
              </button>
              <button
                className="button primary"
                disabled={busy || !data}
                onClick={() => createDialog.current?.showModal()}
              >
                <Plus size={16} />
                New order
              </button>
            </div>
          </div>
          {notice && (
            <div
              role={notice.error ? 'alert' : 'status'}
              className={`notice ${notice.error ? 'error' : ''}`}
            >
              <span>{notice.text}</span>
              <button aria-label="Dismiss notification" onClick={() => setNotice(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {!data ? (
            <div className="loading">
              <Loader2 className="spin" />
              Preparing your demo workspace…
              {notice?.error && (
                <button className="button secondary" onClick={() => act(refresh)}>
                  Retry connection
                </button>
              )}
            </div>
          ) : (
            <>
              <section className="metrics" aria-label="Routing metrics">
                <Metric
                  title="Orders in workspace"
                  value={String(data.orders.length)}
                  detail={`${pending.length} awaiting routing`}
                  icon={<Package size={19} />}
                />
                <Metric
                  title="Allocated orders"
                  value={String(allocated.length)}
                  detail={`${review.length} need review`}
                  icon={<ShieldCheck size={19} />}
                />
                <Metric
                  title="Shipping allocated"
                  value={money(shipping)}
                  detail="Simulated ground service"
                  icon={<Truck size={19} />}
                />
                <Metric
                  title="Routing advantage"
                  value={money(savings)}
                  detail="Vs. other eligible warehouse*"
                  icon={<GitBranch size={19} />}
                />
              </section>
              {tab === 'orders' && (
                <div className="orders-layout">
                  <section className="panel order-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          Order queue <span className="count">{data.orders.length}</span>
                        </h2>
                        <p>Select an order to inspect its routing options.</p>
                      </div>
                      <button
                        className="text-button"
                        disabled={busy || !pending.length}
                        onClick={() =>
                          act(async () => {
                            for (const order of pending) await routeOrder(order.id);
                          }, 'Queue evaluated. Orders with incomplete options are held for review.')
                        }
                      >
                        <Zap size={15} />
                        Route pending
                      </button>
                    </div>
                    <div className="filters">
                      <label className="search">
                        <Search size={16} />
                        <input
                          aria-label="Search orders"
                          placeholder="Search orders or customers"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <select
                        aria-label="Filter order status"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="ALL">All statuses</option>
                        {['PENDING', 'ALLOCATED', 'REVIEW', 'CANCELLED'].map((s) => (
                          <option key={s} value={s}>
                            {label(s)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="table-scroll">
                      <table className="order-table">
                        <thead>
                          <tr>
                            <th>ORDER / CUSTOMER</th>
                            <th>DESTINATION</th>
                            <th>STATUS</th>
                            <th aria-label="Select" />
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map((order) => (
                            <tr
                              key={order.id}
                              className={selectedId === order.id ? 'selected' : ''}
                            >
                              <td>
                                <button
                                  className="order-select"
                                  onClick={() => setSelectedId(order.id)}
                                  aria-label={`Inspect ${order.id}`}
                                >
                                  <strong>{order.id}</strong>
                                  <span>{order.customer}</span>
                                </button>
                              </td>
                              <td>
                                {DESTINATIONS[order.destinationId].city}
                                <small>
                                  {DESTINATIONS[order.destinationId].state} ·{' '}
                                  {DESTINATIONS[order.destinationId].zip}
                                </small>
                              </td>
                              <td>
                                <span className={`badge ${order.status.toLowerCase()}`}>
                                  <span />
                                  {label(order.status)}
                                </span>
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`Open ${order.id}`}
                                  onClick={() => setSelectedId(order.id)}
                                >
                                  <ChevronRight size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!visible.length && <div className="empty">No orders match your search.</div>}
                    </div>
                    <div className="table-footer">
                      <span>{visible.length} orders shown</span>
                      <span>
                        <span className="live-dot" /> Session isolated
                      </span>
                    </div>
                  </section>
                  <section className="panel detail-panel" aria-label="Order details">
                    {selected ? (
                      <>
                        <div className="detail-heading">
                          <span className="eyebrow">ROUTING INSPECTOR</span>
                          <div>
                            <h2>{selected.id}</h2>
                            <span className={`badge ${selected.status.toLowerCase()}`}>
                              {label(selected.status)}
                            </span>
                          </div>
                          <p>{selected.customer}</p>
                        </div>
                        <div className="destination">
                          <span className="icon-tile">
                            <MapPin size={18} />
                          </span>
                          <div>
                            <small>SHIP TO</small>
                            <strong>
                              {DESTINATIONS[selected.destinationId].city},{' '}
                              {DESTINATIONS[selected.destinationId].state}
                            </strong>
                            <span>{DESTINATIONS[selected.destinationId].zip} · United States</span>
                          </div>
                        </div>
                        <div className="line-items">
                          {selected.items.map((item) => (
                            <div key={item.sku}>
                              <span>
                                {PRODUCTS.find((p) => p.sku === item.sku)?.name}
                                <small>{item.sku}</small>
                              </span>
                              <strong>× {item.quantity}</strong>
                            </div>
                          ))}
                        </div>
                        <div className="comparison">
                          <div className="section-heading">
                            <h3>Warehouse comparison</h3>
                            <span>SIMULATED</span>
                          </div>
                          {previewing ? (
                            <div className="empty">
                              <Loader2 className="spin" size={18} /> Comparing options…
                            </div>
                          ) : (
                            decision?.candidates.map((candidate) => {
                              const winner =
                                selected.status !== 'CANCELLED' &&
                                decision.selectedWarehouseId === candidate.warehouseId;
                              const warehouse = WAREHOUSES.find(
                                (w) => w.id === candidate.warehouseId,
                              )!;
                              return (
                                <div
                                  key={candidate.warehouseId}
                                  className={`warehouse-option ${winner ? 'winner' : ''}`}
                                >
                                  <div className="warehouse-top">
                                    <span className="warehouse-code">{warehouse.id}</span>
                                    <div>
                                      <strong>
                                        {warehouse.name}, {warehouse.state}
                                      </strong>
                                      <small>{warehouse.region}</small>
                                    </div>
                                    {winner && (
                                      <span className="winner-icon">
                                        <Check size={15} />
                                      </span>
                                    )}
                                  </div>
                                  <div className="quote">
                                    <strong>
                                      {candidate.costCents === null
                                        ? 'Unavailable'
                                        : money(candidate.costCents)}
                                    </strong>
                                    <span>
                                      {candidate.transitDays
                                        ? `${candidate.transitDays} business day${candidate.transitDays > 1 ? 's' : ''}`
                                        : candidate.eligible
                                          ? 'Quote failed'
                                          : 'Insufficient stock'}
                                    </span>
                                  </div>
                                  <p
                                    className={
                                      !candidate.eligible || candidate.costCents === null
                                        ? 'warning-text'
                                        : ''
                                    }
                                  >
                                    {candidate.reason}
                                  </p>
                                  <div className="stock-detail">
                                    {candidate.stock.map((item) => (
                                      <span key={item.sku}>
                                        {item.sku}: {item.available} / {item.requested} needed
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                        {decision && (
                          <div
                            className={`decision-note ${!decision.selectedWarehouseId ? 'review-note' : ''}`}
                          >
                            <GitBranch size={17} />
                            <div>
                              <strong>
                                {selected.status === 'CANCELLED'
                                  ? 'Previous routing snapshot'
                                  : decision.selectedWarehouseId
                                    ? `${decision.selectedWarehouseId} ${selected.status === 'ALLOCATED' ? 'allocated' : 'recommended'}`
                                    : 'Manual review required'}
                              </strong>
                              <p>{decision.reason}</p>
                              {decision.savingsCents > 0 && (
                                <span>
                                  {money(decision.savingsCents)} below the other eligible option
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="detail-actions">
                          <button
                            className="button primary full"
                            disabled={
                              busy ||
                              selected.status === 'ALLOCATED' ||
                              selected.status === 'CANCELLED'
                            }
                            onClick={() =>
                              act(() => routeOrder(selected.id), 'Routing decision saved.')
                            }
                          >
                            <GitBranch size={16} />
                            {busy
                              ? 'Processing…'
                              : selected.status === 'ALLOCATED'
                                ? 'Inventory reserved'
                                : 'Route this order'}
                            <ArrowRight size={16} />
                          </button>
                          <div>
                            <button
                              className="text-button"
                              disabled={busy || selected.status === 'CANCELLED'}
                              onClick={() => {
                                setOverrideReason('');
                                setOverrideWarehouse(
                                  selected.warehouseId === 'BUF' ? 'RNO' : 'BUF',
                                );
                                overrideDialog.current?.showModal();
                              }}
                            >
                              Manual override
                            </button>
                            <button
                              className="text-button muted"
                              disabled={busy || selected.status === 'CANCELLED'}
                              onClick={() =>
                                act(
                                  () =>
                                    graphql(
                                      'mutation Cancel($id: ID!) { cancelOrder(id: $id) { id } }',
                                      { id: selected.id },
                                    ),
                                  'Order cancelled. Reserved stock released.',
                                )
                              }
                            >
                              Cancel order
                            </button>
                          </div>
                          <small>
                            {selected.decision ? 'Saved decision snapshot · ' : 'Preview only · '}
                            Stock is rechecked when allocating.
                          </small>
                        </div>
                      </>
                    ) : (
                      <div className="empty">Select an order to compare warehouses.</div>
                    )}
                  </section>
                </div>
              )}
              {tab === 'inventory' && (
                <div className="warehouse-grid">
                  {WAREHOUSES.map((warehouse) => (
                    <section className="panel" key={warehouse.id}>
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow">{warehouse.region}</div>
                          <h2>
                            {warehouse.name}, {warehouse.state}
                          </h2>
                        </div>
                        <span className="warehouse-code">{warehouse.id}</span>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>PRODUCT</th>
                              <th>ON HAND</th>
                              <th>RESERVED</th>
                              <th>AVAILABLE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.inventory
                              .filter((i) => i.warehouseId === warehouse.id)
                              .map((i) => (
                                <tr key={i.sku}>
                                  <td>
                                    <strong>{PRODUCTS.find((p) => p.sku === i.sku)?.name}</strong>
                                    <small>{i.sku}</small>
                                  </td>
                                  <td>{i.onHand}</td>
                                  <td>{i.reserved}</td>
                                  <td>
                                    <span
                                      className={
                                        i.available === 0 ? 'stock-zero' : 'stock-positive'
                                      }
                                    >
                                      {i.available}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
                </div>
              )}
              {tab === 'activity' && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Decision trail</h2>
                      <p>Latest 100 events in this workspace.</p>
                    </div>
                    <button className="text-button" disabled={busy} onClick={() => act(refresh)}>
                      <RefreshCw size={15} />
                      Refresh
                    </button>
                  </div>
                  <div className="timeline">
                    {data.events.map((event) => (
                      <article key={event.id}>
                        <span className="timeline-dot">
                          <GitBranch size={15} />
                        </span>
                        <div>
                          <div className="event-title">
                            <strong>{event.action.replaceAll('_', ' ')}</strong>
                            {event.orderId && (
                              <button
                                className="text-button"
                                onClick={() => {
                                  setSelectedId(event.orderId!);
                                  setTab('orders');
                                }}
                              >
                                {event.orderId} <ArrowUpRight size={13} />
                              </button>
                            )}
                            <time>
                              {new Date(event.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </time>
                          </div>
                          <p>{event.detail}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              {tab === 'guide' && (
                <div className="guide-grid">
                  <section className="panel guide">
                    <div className="eyebrow">YOUR FIVE-MINUTE WALKTHROUGH</div>
                    <h2>Follow an order from stock to allocation.</h2>
                    <p>
                      This demo reconstructs a warehouse routing workflow with fictional data. Every
                      shipping quote is calculated locally; no external carrier account is
                      connected.
                    </p>
                    {[
                      [
                        '01',
                        'Compare both warehouses',
                        'Open FR-1042. Both warehouses have desk phones, but Reno has the lower simulated shipping cost to San Francisco.',
                      ],
                      [
                        '02',
                        'Reserve stock',
                        'Route FR-1042, then open Inventory. Reno’s reserved count increases by six. Route the same order again through the API; inventory stays unchanged.',
                      ],
                      [
                        '03',
                        'Let availability win',
                        'Open FR-1043. Reno is closer to Seattle but has no switches. Buffalo is the only eligible warehouse.',
                      ],
                      [
                        '04',
                        'Inspect exceptions',
                        'FR-1044 exceeds stock at both warehouses. FR-1045 simulates an unavailable Reno quote. Route them and inspect the review reasons.',
                      ],
                      [
                        '05',
                        'Exercise human control',
                        'Override an allocation with a reason. Inspect the activity log, then cancel it and verify that reserved stock is released.',
                      ],
                    ].map(([n, title, description]) => (
                      <div className="guide-step" key={n}>
                        <span>{n}</span>
                        <div>
                          <h3>{title}</h3>
                          <p>{description}</p>
                        </div>
                      </div>
                    ))}
                    <button
                      className="button primary"
                      onClick={() => {
                        setSelectedId('FR-1042');
                        setTab('orders');
                      }}
                    >
                      Start with the west coast order <ArrowRight size={16} />
                    </button>
                  </section>
                  <div>
                    <section className="panel race-card">
                      <span className="icon-tile">
                        <ShieldCheck size={23} />
                      </span>
                      <h2>Two orders. One last unit.</h2>
                      <p>
                        Submit two competing allocation calls for the same adapter. One gets the
                        reservation; the other is held for review.
                      </p>
                      <button
                        className="button primary full"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            const r = await graphql<{ runConcurrencyDemo: string }>(
                              'mutation Race { runConcurrencyDemo }',
                            );
                            setNotice({ text: r.runConcurrencyDemo, error: false });
                          }, undefined)
                        }
                      >
                        {busy ? 'Running…' : 'Run concurrency demo'}
                        <Zap size={16} />
                      </button>
                      <small>
                        Uses LAB-001. Reset to repeat. Embedded mode serializes transactions; the
                        PostgreSQL integration test checks separate connections.
                      </small>
                    </section>
                    <section className="panel policy-card">
                      <h3>The routing policy</h3>
                      <p>
                        Full order from one warehouse. Sufficient available stock. Lowest quoted
                        shipping cost. Stable warehouse-code tie-breaker.
                      </p>
                      <p>
                        Missing quotes require review. An override can choose a quoted, stocked
                        warehouse, with a recorded reason.
                      </p>
                      <span className="policy-version">single-warehouse-v1</span>
                    </section>
                  </div>
                </div>
              )}
              <footer className="page-footer">
                <span>Dispatch · Fulfillment Routing Engine</span>
                <span>
                  *Comparison uses eligible quotes at decision time; not measured business savings.
                </span>
              </footer>
            </>
          )}
        </div>
      </main>

      <dialog ref={createDialog}>
        <div className="modal-heading">
          <h2>Create an order</h2>
          <button
            className="icon-button"
            aria-label="Close new order"
            onClick={() => createDialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <p className="modal-description">Use a sample destination to compare both warehouses.</p>
        {notice?.error && (
          <p role="alert" className="modal-error">
            {notice.text}
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const values = new FormData(form);
            const result = await act(
              () =>
                graphql<{ createOrder: Order }>(
                  'mutation Create($input: CreateOrderInput!) { createOrder(input: $input) { id } }',
                  {
                    input: {
                      customer: values.get('customer'),
                      destinationId: values.get('destination'),
                      items: [{ sku: values.get('sku'), quantity: Number(values.get('quantity')) }],
                    },
                  },
                ),
              'Order created.',
            );
            if (result) {
              const r = result as { createOrder: Order };
              setSelectedId(r.createOrder.id);
              setTab('orders');
              form.reset();
              createDialog.current?.close();
            }
          }}
        >
          <label>
            Customer name
            <input
              name="customer"
              required
              minLength={2}
              maxLength={80}
              placeholder="e.g. Northline Studio"
            />
          </label>
          <label>
            Destination
            <select name="destination">
              {Object.entries(DESTINATIONS).map(([id, d]) => (
                <option key={id} value={id}>
                  {d.city}, {d.state} · {d.zip}
                </option>
              ))}
            </select>
          </label>
          <label>
            Product
            <select name="sku">
              {PRODUCTS.filter((p) => p.sku !== 'LAB-001').map((p) => (
                <option key={p.sku} value={p.sku}>
                  {p.name} · {p.sku}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input name="quantity" type="number" required min={1} max={1000} defaultValue={4} />
          </label>
          <button className="button primary full" disabled={busy}>
            Create order <Plus size={16} />
          </button>
        </form>
      </dialog>
      <dialog ref={overrideDialog}>
        <div className="modal-heading">
          <h2>Override warehouse</h2>
          <button
            className="icon-button"
            aria-label="Close override"
            onClick={() => overrideDialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <p className="modal-description">
          Stock and quote availability are still enforced. Existing stock is released only if the
          new reservation succeeds.
        </p>
        {notice?.error && (
          <p role="alert" className="modal-error">
            {notice.text}
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!selected) return;
            const result = await act(
              () =>
                graphql(
                  'mutation Override($id: ID!, $warehouseId: WarehouseId!, $reason: String!) { overrideOrder(id: $id, warehouseId: $warehouseId, reason: $reason) { id } }',
                  { id: selected.id, warehouseId: overrideWarehouse, reason: overrideReason },
                ),
              'Override recorded in the activity log.',
            );
            if (result) overrideDialog.current?.close();
          }}
        >
          <label>
            Warehouse
            <select
              value={overrideWarehouse}
              onChange={(e) => setOverrideWarehouse(e.target.value as WarehouseId)}
            >
              {WAREHOUSES.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}, {w.state}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <textarea
              required
              minLength={8}
              maxLength={300}
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="e.g. Customer requested shipment from the east coast"
            />
          </label>
          <button className="button primary full" disabled={busy}>
            Save override
          </button>
        </form>
      </dialog>
      <dialog ref={resetDialog}>
        <div className="modal-heading">
          <h2>Reset this demo?</h2>
          <button
            className="icon-button"
            aria-label="Close reset"
            onClick={() => resetDialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <p className="modal-description">
          This replaces your orders, reservations, and activity with the original sample data. Other
          browser sessions are unaffected.
        </p>
        <button
          className="button primary full"
          disabled={busy}
          onClick={() =>
            act(async () => {
              await graphql('mutation Reset { resetDemo }');
              setSelectedId('FR-1042');
              resetDialog.current?.close();
            }, 'Demo restored to its starting state.')
          }
        >
          Reset workspace
        </button>
      </dialog>
    </div>
  );
}

function Metric({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="metric">
      <div>
        <span>{title}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
