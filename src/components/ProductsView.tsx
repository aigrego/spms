'use client';

import * as React from 'react';
import { Plus, Box, GitBranch } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProjectIcon } from '@/components/glyphs/misc';
import { PRODUCT_STATUS, RELEASE_STATUS } from '@/lib/constants';
import { ConfirmDestructive } from '@/components/ConfirmDestructive';
import { ResourcePanel } from '@/components/ResourcePanel';
import { RowActions } from '@/components/RowActions';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useAllIssues } from '@/store/issues';
import {
  useCreateProductLine,
  useUpdateProductLine,
  useDeleteProductLine,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useCreateRelease,
  useUpdateRelease,
  useDeleteRelease,
} from '@/store/catalog';
import type { ProductLine, Product, Release, ProductStatus, ReleaseStatus } from '@/lib/types';

const SWATCHES = ['#0063D3', '#1F9D55', '#7A5AE0', '#D89400', '#D6293E', '#0EA5A5', '#DB5A00'];
const PRODUCT_ICONS = ['box', 'zap', 'eye', 'target', 'activity'];
const PRODUCT_STATUSES: ProductStatus[] = ['active', 'maintenance', 'archived'];
const RELEASE_STATUSES: ReleaseStatus[] = ['planned', 'in_progress', 'released', 'deprecated'];

const fieldLabel = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-3';
const inputCls =
  'h-9 w-full rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 outline-none focus:border-brand-blue';

type ModalState =
  | { kind: 'line'; entity?: ProductLine }
  | { kind: 'product'; entity?: Product; lineId?: string }
  | { kind: 'release'; entity?: Release; productId?: string };

function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SWATCHES.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          aria-label={c}
          className="h-6 w-6 rounded-md ring-offset-1 transition-transform hover:scale-110"
          style={{ background: c, outline: value === c ? `2px solid var(--fg-1)` : 'none', outlineOffset: 1 }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit modal for product lines, products, releases          */
/* ------------------------------------------------------------------ */
function CatalogModal({ state, onClose }: { state: ModalState; onClose: () => void }) {
  const t = useT();
  const { productLines, products, humans } = useAppData();

  const createLine = useCreateProductLine();
  const updateLine = useUpdateProductLine();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const createRelease = useCreateRelease();
  const updateRelease = useUpdateRelease();

  const e = state.entity;
  const [name, setName] = React.useState(e?.name ?? '');
  const [description, setDescription] = React.useState(e?.description ?? '');
  const [color, setColor] = React.useState(
    (e && 'color' in e ? (e as ProductLine | Product).color : undefined) ?? '#0063D3',
  );
  const [icon, setIcon] = React.useState(state.kind === 'product' ? (state.entity?.icon ?? 'box') : 'box');
  const [parentId, setParentId] = React.useState(
    state.kind === 'product'
      ? state.entity?.productLineId ?? state.lineId ?? productLines[0]?.id ?? ''
      : state.kind === 'release'
        ? state.entity?.productId ?? state.productId ?? products[0]?.id ?? ''
        : '',
  );
  const [status, setStatus] = React.useState<string>(
    state.kind === 'product'
      ? state.entity?.status ?? 'active'
      : state.kind === 'release'
        ? state.entity?.status ?? 'planned'
        : '',
  );
  const [leadId, setLeadId] = React.useState(state.kind === 'product' ? state.entity?.leadId ?? '' : '');
  const [progress, setProgress] = React.useState(
    state.kind === 'release' ? Math.round((state.entity?.progress ?? 0) * 100) : 0,
  );

  const editing = !!e;
  const titleKey =
    state.kind === 'line' ? 'products.newLine' : state.kind === 'product' ? 'products.newProduct' : 'products.newRelease';

  const busy =
    createLine.isPending || updateLine.isPending || createProduct.isPending || updateProduct.isPending ||
    createRelease.isPending || updateRelease.isPending;

  const submit = async () => {
    if (!name.trim()) return;
    if (state.kind === 'line') {
      if (editing) await updateLine.mutateAsync({ id: e!.id, input: { name: name.trim(), description, color } });
      else await createLine.mutateAsync({ name: name.trim(), description, color });
    } else if (state.kind === 'product') {
      const input = {
        productLineId: parentId,
        name: name.trim(),
        description,
        icon,
        color,
        status: status as ProductStatus,
        leadId: leadId || null,
      };
      if (editing) await updateProduct.mutateAsync({ id: e!.id, input });
      else await createProduct.mutateAsync(input);
    } else {
      const input = {
        productId: parentId,
        name: name.trim(),
        description,
        status: status as ReleaseStatus,
        progress: progress / 100,
      };
      if (editing) await updateRelease.mutateAsync({ id: e!.id, input });
      else await createRelease.mutateAsync(input);
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          {t(titleKey)}
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3.5 px-[18px] py-3">
          {state.kind === 'product' && (
            <div>
              <span className={fieldLabel}>{t('nav.products')}</span>
              <select className={inputCls} value={parentId} onChange={(ev) => setParentId(ev.target.value)}>
                {productLines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {state.kind === 'release' && (
            <div>
              <span className={fieldLabel}>{t('detail.product')}</span>
              <select className={inputCls} value={parentId} onChange={(ev) => setParentId(ev.target.value)}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <span className={fieldLabel}>{t('form.name')}</span>
            <input
              autoFocus
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              placeholder={state.kind === 'release' ? 'v2.4 / 2026.06' : ''}
              className={inputCls}
            />
          </div>
          {state.kind !== 'release' && (
            <div>
              <span className={fieldLabel}>{t('form.color')}</span>
              <ColorSwatches value={color} onChange={setColor} />
            </div>
          )}
          {state.kind === 'product' && (
            <div className="flex gap-3">
              <div className="flex-1">
                <span className={fieldLabel}>{t('requirements.status')}</span>
                <select className={inputCls} value={status} onChange={(ev) => setStatus(ev.target.value)}>
                  {PRODUCT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`productStatus.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <span className={fieldLabel}>{t('products.lead')}</span>
                <select className={inputCls} value={leadId} onChange={(ev) => setLeadId(ev.target.value)}>
                  <option value="">—</option>
                  {humans.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {state.kind === 'product' && (
            <div>
              <span className={fieldLabel}>{t('form.icon')}</span>
              <div className="flex gap-1.5">
                {PRODUCT_ICONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setIcon(ic)}
                    className="grid h-8 w-8 place-items-center rounded-lg border"
                    style={{
                      borderColor: icon === ic ? color : 'var(--border)',
                      background: icon === ic ? color : 'var(--surface-2)',
                    }}
                  >
                    <ProjectIcon name={ic} size={16} color={icon === ic ? '#fff' : 'var(--fg-3)'} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {state.kind === 'release' && (
            <div className="flex gap-3">
              <div className="flex-1">
                <span className={fieldLabel}>{t('requirements.status')}</span>
                <select className={inputCls} value={status} onChange={(ev) => setStatus(ev.target.value)}>
                  {RELEASE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`releaseStatus.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-[120px]">
                <span className={fieldLabel}>{t('products.releaseProgress', { pct: progress })}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={progress}
                  onChange={(ev) => setProgress(Number(ev.target.value))}
                  className="mt-2 w-full accent-[var(--brand-blue)]"
                />
              </div>
            </div>
          )}
          <div>
            <span className={fieldLabel}>{t('form.desc')}</span>
            <textarea
              value={description ?? ''}
              onChange={(ev) => setDescription(ev.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-border-strong bg-surface px-2.5 py-2 text-[13px] text-fg-1 outline-none focus:border-brand-blue"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!name.trim() || busy}>
            {editing ? t('common.save') : t(titleKey)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Products view — 产品线 → 产品 → 版本 lifecycle catalog              */
/* ------------------------------------------------------------------ */
type DeleteTarget =
  | { kind: 'line'; entity: ProductLine }
  | { kind: 'product'; entity: Product }
  | { kind: 'release'; entity: Release };

export function ProductsView() {
  const t = useT();
  const { productLines, products, releases, projects, sprints, can } = useAppData();
  const canWrite = can('products', 'write');
  const { data: issues = [] } = useAllIssues();
  const [modal, setModal] = React.useState<ModalState | null>(null);
  const [delTarget, setDelTarget] = React.useState<DeleteTarget | null>(null);

  const delLine = useDeleteProductLine();
  const delProduct = useDeleteProduct();
  const delRelease = useDeleteRelease();

  // A product line is not an assignment node, so compute its cascade impact here.
  const lineChips = (lineId: string): string[] => {
    const prods = products.filter((p) => p.productLineId === lineId);
    const prodIds = new Set(prods.map((p) => p.id));
    const rels = releases.filter((r) => prodIds.has(r.productId));
    const relIds = new Set(rels.map((r) => r.id));
    const projs = projects.filter((p) => p.releaseId && relIds.has(p.releaseId));
    const projIds = new Set(projs.map((p) => p.id));
    const sprs = sprints.filter((s) => s.projectId && projIds.has(s.projectId));
    const out: string[] = [];
    if (prods.length) out.push(t('confirm.impactProducts', { n: prods.length }));
    if (rels.length) out.push(t('confirm.impactReleases', { n: rels.length }));
    if (projs.length) out.push(t('confirm.impactProjects', { n: projs.length }));
    if (sprs.length) out.push(t('confirm.impactSprints', { n: sprs.length }));
    return out;
  };

  const confirmDelete = () => {
    if (!delTarget) return;
    const close = { onSuccess: () => setDelTarget(null) };
    if (delTarget.kind === 'line') delLine.mutate(delTarget.entity.id, close);
    else if (delTarget.kind === 'product') delProduct.mutate(delTarget.entity.id, close);
    else delRelease.mutate(delTarget.entity.id, close);
  };
  const delBusy = delLine.isPending || delProduct.isPending || delRelease.isPending;

  const releasesOf = (productId: string) => releases.filter((r) => r.productId === productId);
  const productsOf = (lineId: string) => products.filter((p) => p.productLineId === lineId);
  const projectCountForReleases = (releaseIds: Set<string>) =>
    projects.filter((p) => p.releaseId && releaseIds.has(p.releaseId)).length;
  const issueCountForReleases = (releaseIds: Set<string>) => {
    const projIds = new Set(projects.filter((p) => p.releaseId && releaseIds.has(p.releaseId)).map((p) => p.id));
    return issues.filter((i) => i.projectId && projIds.has(i.projectId)).length;
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <h1 className="m-0 text-[18px] font-semibold tracking-tight text-fg-1">{t('products.title')}</h1>
        <span className="rounded-full bg-surface-2 px-2.5 py-px text-[12.5px] font-semibold text-fg-3">
          {productLines.length}
        </span>
        <span className="text-[12.5px] text-fg-3">· {t('products.subtitle')}</span>
        <div className="flex-1" />
        {canWrite && (
          <Button variant="primary" size="md" onClick={() => setModal({ kind: 'line' })}>
            <Plus size={14} /> {t('products.newLine')}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {productLines.length === 0 && (
          <div className="grid h-full place-items-center text-[13px] text-fg-3">{t('products.empty')}</div>
        )}
        <div className="flex flex-col gap-7">
          {productLines.map((line) => {
            const lineProducts = productsOf(line.id);
            return (
              <section key={line.id}>
                {/* product-line header */}
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="h-3.5 w-3.5 flex-none rounded-[5px]" style={{ background: line.color }} />
                  <h2 className="m-0 text-[15px] font-semibold text-fg-1">{line.name}</h2>
                  <span className="rounded-full bg-surface-2 px-2 py-px text-[11.5px] font-semibold text-fg-3">
                    {lineProducts.length}
                  </span>
                  {line.description && (
                    <span className="truncate text-[12.5px] text-fg-3">{line.description}</span>
                  )}
                  <div className="flex-1" />
                  {canWrite && (
                    <RowActions
                      onEdit={() => setModal({ kind: 'line', entity: line })}
                      onDelete={() => setDelTarget({ kind: 'line', entity: line })}
                    />
                  )}
                  {canWrite && (
                    <Button variant="ghost" size="sm" onClick={() => setModal({ kind: 'product', lineId: line.id })}>
                      <Plus size={13} /> {t('products.newProduct')}
                    </Button>
                  )}
                </div>

                {lineProducts.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-fg-3">
                    {t('products.noProducts')}
                  </div>
                ) : (
                  <div
                    className="grid gap-4"
                    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}
                  >
                    {lineProducts.map((product) => {
                      const rels = releasesOf(product.id);
                      const relIds = new Set(rels.map((r) => r.id));
                      const ps = PRODUCT_STATUS[product.status];
                      return (
                        <div
                          key={product.id}
                          className="rounded-[14px] border border-border bg-surface p-[18px] shadow-1"
                        >
                          <div className="mb-3 flex items-center gap-2.5">
                            <span
                              className="grid h-9 w-9 flex-none place-items-center rounded-[10px]"
                              style={{ background: product.color }}
                            >
                              <ProjectIcon name={product.icon} size={18} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[14.5px] font-semibold text-fg-1">{product.name}</div>
                              <div className="mt-0.5 flex items-center gap-1.5">
                                <Badge tone={ps.tone} dot>
                                  {t(`productStatus.${product.status}`)}
                                </Badge>
                              </div>
                            </div>
                            {canWrite && (
                              <RowActions
                                onEdit={() => setModal({ kind: 'product', entity: product })}
                                onDelete={() => setDelTarget({ kind: 'product', entity: product })}
                              />
                            )}
                          </div>
                          {product.description && (
                            <p className="mb-3 line-clamp-2 text-[12.5px] leading-normal text-fg-2">
                              {product.description}
                            </p>
                          )}

                          {/* releases rail */}
                          <div className="mb-2.5 flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                              {t('products.releasesLabel')}
                            </span>
                            {canWrite && (
                              <button
                                onClick={() => setModal({ kind: 'release', productId: product.id })}
                                className="hover-surface inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11.5px] text-fg-3"
                              >
                                <Plus size={12} /> {t('products.newRelease')}
                              </button>
                            )}
                          </div>
                          {rels.length === 0 ? (
                            <div className="text-[12px] text-fg-3">{t('products.noReleases')}</div>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              {rels.map((r) => {
                                const rs = RELEASE_STATUS[r.status];
                                return (
                                  <div
                                    key={r.id}
                                    className="group flex items-center gap-2.5 rounded-[9px] border border-border px-2.5 py-1.5"
                                  >
                                    <span
                                      className="h-2 w-2 flex-none rounded-full"
                                      style={{ background: rs.color }}
                                    />
                                    <span className="min-w-0 truncate font-mono text-[12px] font-semibold text-fg-1">
                                      {r.name}
                                    </span>
                                    <Badge tone={rs.tone}>{t(`releaseStatus.${r.status}`)}</Badge>
                                    <div className="ml-1 h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                                      <div
                                        className="h-full rounded-full"
                                        style={{ width: `${Math.round(r.progress * 100)}%`, background: rs.color }}
                                      />
                                    </div>
                                    <span className="w-9 flex-none text-right text-[11px] tabular-nums text-fg-3">
                                      {Math.round(r.progress * 100)}%
                                    </span>
                                    <div className="flex-none opacity-0 transition-opacity group-hover:opacity-100">
                                      {canWrite && (
                                        <RowActions
                                          onEdit={() => setModal({ kind: 'release', entity: r })}
                                          onDelete={() => setDelTarget({ kind: 'release', entity: r })}
                                        />
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* footer: virtual team + delivery counts */}
                          <div className="mt-3 flex items-center gap-2.5 border-t border-border pt-2.5">
                            <ResourcePanel nodeType="product" nodeId={product.id} variant="compact" />
                            <div className="flex-1" />
                            <span className="inline-flex items-center gap-1 text-[12px] text-fg-3">
                              <Box size={13} /> {projectCountForReleases(relIds)}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[12px] text-fg-3">
                              <GitBranch size={13} /> {issueCountForReleases(relIds)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {modal && <CatalogModal state={modal} onClose={() => setModal(null)} />}
      {delTarget && (
        <ConfirmDestructive
          open
          onOpenChange={(o) => !o && setDelTarget(null)}
          name={delTarget.entity.name}
          node={delTarget.kind === 'line' ? undefined : { nodeType: delTarget.kind, nodeId: delTarget.entity.id }}
          chips={delTarget.kind === 'line' ? lineChips(delTarget.entity.id) : undefined}
          busy={delBusy}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
