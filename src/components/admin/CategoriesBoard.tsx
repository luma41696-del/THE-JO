"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { getIdToken } from "@/lib/firebase/auth";
import { ACCEPT_ATTRIBUTE, uploadMerchandisingImage } from "@/lib/firebase/upload";
import { buildCategoryTree } from "@/lib/categories";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import { Panel } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import type { Category, CategoryNode, ProductImage } from "@/types";

/**
 * Category manager.
 *
 * The tree is the product of the shop's navigation, so it is edited as a tree:
 * departments with their subcategories nested under them, in the order they
 * appear on the site. A flat table sorted by `order` would be easier to build
 * and impossible to reason about — "why is Blazers above Dresses" has no
 * answer when the two are at different depths.
 *
 * Reordering is by nudge rather than drag. A drag handle needs a pointer, and
 * this is used on a tablet as often as a laptop; arrows also give the keyboard
 * a way in, which drag never does without a great deal of extra work.
 */

type Draft = {
  id: string | null;
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  parentId: string | null;
  image: ProductImage | null;
  order: number;
  featured: boolean;
  showInNav: boolean;
  hidden: boolean;
};

function toDraft(category: Category | null, parentId: string | null = null): Draft {
  if (!category) {
    return {
      id: null,
      slug: "",
      nameEn: "",
      nameAr: "",
      descriptionEn: "",
      descriptionAr: "",
      parentId,
      image: null,
      order: 10,
      featured: false,
      showInNav: true,
      hidden: false,
    };
  }
  return {
    id: category.id,
    slug: category.slug,
    nameEn: category.name.en,
    nameAr: category.name.ar,
    descriptionEn: category.description?.en ?? "",
    descriptionAr: category.description?.ar ?? "",
    parentId: category.parentId,
    image: category.image ?? null,
    order: category.order,
    featured: category.featured,
    showInNav: category.showInNav !== false,
    hidden: category.hidden === true,
  };
}

export function CategoriesBoard({ categories }: { categories: Category[] }) {
  const { t } = useAdminLocale();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  /**
   * Everything that may legally be this category's parent.
   *
   * Itself and its own descendants are excluded: filing a department under
   * its own child makes a loop, and the loop does not announce itself — the
   * server stops walking it, so the department simply disappears from the
   * nav with nothing to explain why.
   *
   * Listed in tree order and indented, because a flat alphabetical list of
   * forty categories is one nobody can pick the right parent out of.
   */
  const parentOptions = useMemo(() => {
    const banned = new Set<string>();
    if (draft?.id) {
      banned.add(draft.id);
      let added = true;
      while (added) {
        added = false;
        for (const category of categories) {
          if (category.parentId && banned.has(category.parentId) && !banned.has(category.id)) {
            banned.add(category.id);
            added = true;
          }
        }
      }
    }

    const flatten = (parentId: string | null, depth: number): Category[] =>
      categories
        .filter((category) => (category.parentId ?? null) === parentId)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        .flatMap((category) =>
          banned.has(category.id)
            ? []
            : [{ ...category, depth }, ...flatten(category.id, depth + 1)],
        );

    return flatten(null, 0);
  }, [categories, draft?.id]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  async function save() {
    if (!draft) return;
    setError(null);
    if (!draft.nameEn.trim() || !draft.nameAr.trim()) {
      return setError(t("cat.nameRequired"));
    }
    // Where the alt-text requirement landed once the prompt went: at the
    // point it costs something, with the picture on screen beside the field.
    if (draft.image && !draft.image.alt.trim()) return setError(t("cat.altRequired"));

    setSaving(true);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          id: draft.id ?? undefined,
          slug: draft.slug || draft.nameEn,
          name: { en: draft.nameEn.trim(), ar: draft.nameAr.trim() },
          description:
            draft.descriptionEn.trim() || draft.descriptionAr.trim()
              ? { en: draft.descriptionEn.trim(), ar: draft.descriptionAr.trim() }
              : null,
          parentId: draft.parentId,
          image: draft.image,
          order: draft.order,
          featured: draft.featured,
          showInNav: draft.showInNav,
          hidden: draft.hidden,
        }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        persisted?: boolean;
        repathed?: number;
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? t("cat.saveFailed"));
      if (data.persisted === false) {
        setError(t("cat.notStored"));
        return;
      }
      setDraft(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cat.saveError"));
    } finally {
      setSaving(false);
    }
  }

  /** Reorder and visibility, sent as a bulk patch. */
  async function patch(updates: { id: string; order?: number; hidden?: boolean; showInNav?: boolean }[]) {
    if (updates.length === 0) return;
    setBusyId(updates[0]!.id);
    setError(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/categories", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ updates }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; persisted?: boolean };
      if (!response.ok || !data.ok) throw new Error(data.error ?? t("cat.updateFailed"));
      if (data.persisted === false) {
        setError(t("cat.notStored"));
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cat.updateError"));
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Swap a node with its neighbour at the same level.
   *
   * Two writes rather than renumbering the whole list: a swap is what the
   * merchant asked for, and rewriting every sibling's `order` would make the
   * audit log unreadable the first time someone nudges a row.
   */
  function move(siblings: CategoryNode[], index: number, delta: number) {
    const target = siblings[index + delta];
    const self = siblings[index];
    if (!target || !self) return;
    void patch([
      { id: self.id, order: target.order },
      { id: target.id, order: self.order },
    ]);
  }

  /**
   * Upload the tile image. Ask for its description afterwards.
   *
   * The prompt this replaces ran before the upload and threw the chosen file
   * away on Cancel. Worse, it asked somebody to describe a picture that was
   * not on screen yet, which reliably produces the filename typed back in —
   * a screen reader then reads "IMG underscore four eight two one dot jpeg"
   * where silence would have told the listener more.
   */
  async function pickImage(files: FileList | null) {
    if (!files || files.length === 0 || !draft) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadMerchandisingImage("categories", files[0]!, "");
      set("image", uploaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cat.uploadError"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <AdminPageHeader
        title={t("cat.title")}
        description={t("cat.subtitle")}
        actions={
          <Button variant="brand" size="sm" onClick={() => setDraft(toDraft(null))}>
            {t("cat.newDepartment")}
          </Button>
        }
      />

      {error && (
        <p role="alert" className="text-alert mb-3 text-[0.8125rem]">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Panel title={t("cat.tree")} description={t("cat.treeHint")}>
          {tree.length === 0 ? (
            <p className="text-mist py-8 text-center text-[0.875rem]">
              {t("cat.empty")}
            </p>
          ) : (
            <ul className="divide-line divide-y">
              {tree.map((department, di) => (
                <li key={department.id} className="py-2">
                  <Row
                    node={department}
                    busy={busyId === department.id}
                    onEdit={() => setDraft(toDraft(department))}
                    onUp={() => move(tree, di, -1)}
                    onDown={() => move(tree, di, 1)}
                    canUp={di > 0}
                    canDown={di < tree.length - 1}
                    onToggleHidden={() =>
                      patch([{ id: department.id, hidden: !department.hidden }])
                    }
                    onToggleNav={() =>
                      patch([{ id: department.id, showInNav: department.showInNav === false }])
                    }
                    onAddChild={() => setDraft(toDraft(null, department.id))}
                  />

                  {department.children.length > 0 && (
                    <ul className="border-line/60 ms-6 mt-1 border-s ps-3">
                      {department.children.map((child, ci) => (
                        <li key={child.id} className="py-1">
                          <Row
                            node={child}
                            child
                            busy={busyId === child.id}
                            onEdit={() => setDraft(toDraft(child))}
                            onUp={() => move(department.children, ci, -1)}
                            onDown={() => move(department.children, ci, 1)}
                            canUp={ci > 0}
                            canDown={ci < department.children.length - 1}
                            onToggleHidden={() => patch([{ id: child.id, hidden: !child.hidden }])}
                            onToggleNav={() =>
                              patch([{ id: child.id, showInNav: child.showInNav === false }])
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={draft ? (draft.id ? t("cat.edit") : t("cat.new")) : t("cat.nothingSelected")}
          description={
            draft
              ? t("cat.movingHint")
              : t("cat.pickHint")
          }
        >
          {!draft ? (
            <p className="text-mist py-8 text-center text-[0.875rem]">
              {t("cat.selectToEdit")}
            </p>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("cat.nameEn")} value={draft.nameEn} onChange={(v) => set("nameEn", v)} />
                <Field label="الاسم (عربي)" value={draft.nameAr} onChange={(v) => set("nameAr", v)} rtl />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t("cat.descEn")}
                  value={draft.descriptionEn}
                  onChange={(v) => set("descriptionEn", v)}
                  multiline
                />
                <Field
                  label="الوصف (عربي)"
                  value={draft.descriptionAr}
                  onChange={(v) => set("descriptionAr", v)}
                  multiline
                  rtl
                />
              </div>

              <Field
                label={t("cat.slug")}
                value={draft.slug}
                onChange={(v) => set("slug", v)}
                mono
                hint={t("cat.slugHint")}
              />

              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{t("cat.sitsUnder")}</span>
                <select
                  value={draft.parentId ?? ""}
                  onChange={(e) => set("parentId", e.target.value || null)}
                  className={inputClass}
                >
                  <option value="">— {t("cat.topLevel")} —</option>
                  {/*
                    Any category may be a parent, not only a department.
                    
                    This listed departments alone, so a third level could not be
                    created here at all — and the nav menu's own layout is built
                    on one: a subcategory becomes a heading and *its* children
                    become the circles beneath it. The shop could not produce
                    the shape its own menu is designed to render.
                    
                    A category cannot be filed under itself or under anything
                    beneath it. The server guards the resulting cycle too, but
                    it guards by giving up on the walk — the tree would survive
                    and the merchant would be left with a department that had
                    silently vanished from the nav.
                  */}
                  {parentOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {"— ".repeat(option.depth)}
                      {option.name.en}
                    </option>
                  ))}
                </select>
                <span className="text-mist mt-1 block text-[0.6875rem]">
                  {/* This is the expensive edit, and it is worth saying so. */}
                  Moving a category rewrites the ancestry on every product filed
                  under it, so listings keep working.
                </span>
              </label>

              <div>
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{t("cat.tileImage")}</span>
                <div className="flex items-center gap-2">
                  <label
                    className={cn(
                      "border-line hover:border-brand text-mist hover:text-brand grid h-24 w-20 shrink-0 place-items-center rounded-md border border-dashed text-[0.6875rem]",
                      uploading ? "cursor-wait opacity-60" : "cursor-pointer",
                    )}
                  >
                    {draft.image ? (
                      <span className="relative h-full w-full overflow-hidden rounded-md">
                        <Image
                          src={draft.image.url}
                          alt=""
                          fill
                          sizes="80px"
                          className="object-cover"
                        />
                      </span>
                    ) : (
                      <span>{uploading ? "…" : t("cat.upload")}</span>
                    )}
                    <input
                      type="file"
                      accept={ACCEPT_ATTRIBUTE}
                      disabled={uploading}
                      onChange={(e) => pickImage(e.target.files)}
                      className="sr-only"
                    />
                  </label>
                  {draft.image && (
                    <button
                      type="button"
                      onClick={() => set("image", null)}
                      className="text-alert cursor-pointer text-[0.75rem]"
                    >
                      {t("common.remove")}
                    </button>
                  )}
                </div>

                {/* The description, beside the picture, with a red edge
                    while it is empty. The save refuses until it is filled. */}
                {draft.image && (
                  <input
                    value={draft.image.alt}
                    onChange={(event) =>
                      set("image", { ...draft.image!, alt: event.target.value })
                    }
                    placeholder={t("cat.altPlaceholder")}
                    aria-label={t("cat.altPlaceholder")}
                    className={cn(
                      "focus:border-brand bg-paper text-ink placeholder:text-mist mt-1.5 w-full rounded-md border px-2 py-1 text-[0.6875rem] outline-none transition-colors",
                      draft.image.alt.trim() ? "border-line" : "border-alert",
                    )}
                  />
                )}
              </div>

              <div className="grid gap-3">
                <Check
                  label={t("cat.showInNav")}
                  checked={draft.showInNav}
                  onChange={(v) => set("showInNav", v)}
                />
                <Check
                  label={t("cat.feature")}
                  checked={draft.featured}
                  onChange={(v) => set("featured", v)}
                />
                <Check
                  label={t("cat.hiddenLabel")}
                  hint={t("cat.hiddenHint")}
                  checked={draft.hidden}
                  onChange={(v) => set("hidden", v)}
                />
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="text-smoke hover:text-ink cursor-pointer text-[0.8125rem]"
                >
                  {t("common.cancel")}
                </button>
                <Button variant="brand" size="sm" loading={saving} onClick={save}>
                  {draft.id ? t("cat.saveChanges") : t("cat.create")}
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

const inputClass =
  "border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none";

function Row({
  node,
  child = false,
  busy,
  onEdit,
  onUp,
  onDown,
  canUp,
  canDown,
  onToggleHidden,
  onToggleNav,
  onAddChild,
}: {
  node: CategoryNode;
  child?: boolean;
  busy: boolean;
  onEdit: () => void;
  onUp: () => void;
  onDown: () => void;
  canUp: boolean;
  canDown: boolean;
  onToggleHidden: () => void;
  onToggleNav: () => void;
  onAddChild?: () => void;
}) {
  const { t } = useAdminLocale();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 text-start"
        data-cursor="hover"
      >
        <span
          className={cn(
            "text-ink block truncate font-medium",
            child ? "text-[0.8125rem]" : "text-[0.9375rem]",
            node.hidden && "line-through opacity-50",
          )}
        >
          {node.name.en}
          <span className="text-mist ms-2 font-normal">{node.name.ar}</span>
        </span>
        <span className="text-mist block text-[0.6875rem] tabular-nums">
          {node.productCount} {t("cat.pieces")} · /{node.slug}
          {node.showInNav === false && ` · ${t("cat.notInMenu")}`}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {onAddChild && (
          <Mini onClick={onAddChild} label={t("cat.addChild")}>
            +
          </Mini>
        )}
        <Mini onClick={onUp} disabled={!canUp || busy} label={t("cat.moveUp")}>
          ↑
        </Mini>
        <Mini onClick={onDown} disabled={!canDown || busy} label={t("cat.moveDown")}>
          ↓
        </Mini>
        <Mini onClick={onToggleNav} disabled={busy} label={t("cat.showInMenu")}>
          {node.showInNav === false ? "☐" : "☑"}
        </Mini>
        <Mini onClick={onToggleHidden} disabled={busy} label={t("cat.hide")} danger={!node.hidden}>
          {node.hidden ? "↩" : "⌫"}
        </Mini>
      </div>
    </div>
  );
}

function Mini({
  children,
  onClick,
  label,
  disabled = false,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "hover:bg-paper-sunken grid h-7 w-7 cursor-pointer place-items-center rounded-md text-[0.75rem] transition-colors disabled:opacity-30",
        danger ? "text-alert" : "text-ink-muted hover:text-ink",
      )}
      data-cursor="hover"
    >
      {children}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  multiline = false,
  mono = false,
  rtl = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  multiline?: boolean;
  mono?: boolean;
  rtl?: boolean;
}) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <label className="block">
      <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{label}</span>
      <Tag
        dir={rtl ? "rtl" : undefined}
        rows={multiline ? 2 : undefined}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          onChange(e.target.value)
        }
        className={cn(inputClass, mono && "font-mono")}
      />
      {hint && <span className="text-mist mt-1 block text-[0.6875rem]">{hint}</span>}
    </label>
  );
}

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-brand mt-0.5"
      />
      <span className="text-ink text-[0.8125rem]">
        {label}
        {hint && <span className="text-mist block text-[0.6875rem]">{hint}</span>}
      </span>
    </label>
  );
}
