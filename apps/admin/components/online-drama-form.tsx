"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { adminCreateOnlineDrama, adminListCategories } from "@velvet/api-client";
import { Button, Input, Select } from "@velvet/ui";
import { useI18n } from "@/lib/i18n";

type Category = { slug: string; nameZh?: string; nameEn?: string };

type EpisodeRow = {
  episodeNumber: number;
  title: string;
  sourceUrl: string;
};

const emptyEpisode = (n: number): EpisodeRow => ({
  episodeNumber: n,
  title: "",
  sourceUrl: "",
});

export function OnlineDramaForm() {
  const { t } = useI18n();
  const [titleZh, setTitleZh] = useState("");
  const [slug, setSlug] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [descriptionZh, setDescriptionZh] = useState("");
  const [bulk, setBulk] = useState("");
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([emptyEpisode(1)]);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState(0);

  const categoriesQ = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminListCategories(true) as Promise<Category[]>,
  });

  const createMut = useMutation({
    mutationFn: (status: "LIVE" | "DRAFT") => {
      const fromRows = episodes
        .map((ep) => ({
          episodeNumber: ep.episodeNumber,
          title: ep.title.trim() || undefined,
          sourceUrl: ep.sourceUrl.trim(),
        }))
        .filter((ep) => ep.sourceUrl);
      const maxNo = fromRows.reduce((m, ep) => Math.max(m, ep.episodeNumber), 0);
      const fromBulk = bulk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((sourceUrl, index) => ({
          episodeNumber: maxNo + index + 1,
          sourceUrl,
        }));
      const all = [...fromRows, ...fromBulk];
      if (!titleZh.trim()) throw new Error(t("onlineNeedTitle"));
      if (!categorySlug) throw new Error(t("onlineNeedCategory"));
      if (!all.length) throw new Error(t("onlineNeedEpisodes"));
      return adminCreateOnlineDrama({
        titleZh: titleZh.trim(),
        slug: slug.trim() || undefined,
        categorySlug,
        coverUrl: coverUrl.trim() || undefined,
        descriptionZh: descriptionZh.trim() || undefined,
        lockMode: "ALL_FREE",
        freeEpisodeCount: all.length,
        status,
        episodes: all,
      });
    },
    onSuccess: (data) => {
      setError(null);
      setCreatedId(data.id);
      setCreatedCount(data.totalEpisodes);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-body-sm text-ink-muted">{t("contentAddOnlineHint")}</p>
      {error ? <p className="text-body-sm text-danger">{error}</p> : null}
      {createdId ? (
        <div className="card glass-card flex flex-wrap items-center gap-3 p-4 text-body-sm">
          <span>{t("onlineCreated", { n: createdCount })}</span>
          <Link href={`/content/${createdId}`} className="text-brand hover:underline">
            {t("onlineViewDrama")}
          </Link>
        </div>
      ) : null}

      <div className="card glass-card grid gap-3 p-4 md:grid-cols-2">
        <label className="text-caption text-ink-muted">
          {t("onlineTitleZh")}
          <Input className="mt-1" value={titleZh} onChange={(e) => setTitleZh(e.target.value)} />
        </label>
        <label className="text-caption text-ink-muted">
          {t("onlineSlug")}
          <Input className="mt-1" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
        <label className="text-caption text-ink-muted">
          {t("onlineCategory")}
          <Select
            className="mt-1"
            value={categorySlug}
            onChange={(e) => setCategorySlug(e.target.value)}
          >
            <option value="">{t("onlineCategory")}</option>
            {(categoriesQ.data ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.nameZh || c.nameEn || c.slug}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-caption text-ink-muted">
          {t("onlineCoverUrl")}
          <Input className="mt-1" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} />
        </label>
        <label className="text-caption text-ink-muted md:col-span-2">
          {t("onlineDescZh")}
          <textarea
            className="mt-1 min-h-20 w-full rounded-md border border-line bg-surface px-3 py-2 text-body-sm"
            value={descriptionZh}
            onChange={(e) => setDescriptionZh(e.target.value)}
          />
        </label>
      </div>

      <div className="card glass-card space-y-3 p-4">
        <div>
          <h3 className="text-h4 font-semibold">{t("onlineEpisodesTitle")}</h3>
          <p className="text-body-sm text-ink-muted">{t("onlineEpisodesHint")}</p>
        </div>
        <label className="block text-caption text-ink-muted">
          {t("onlineEpisodesBulk")}
          <textarea
            className="mt-1 min-h-24 w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-caption"
            placeholder="https://cdn.example.com/ep1/index.m3u8"
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
          />
        </label>
        {episodes.map((ep, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <label className="text-caption text-ink-muted">
              #
              <Input
                type="number"
                className="mt-1 w-16"
                value={ep.episodeNumber}
                onChange={(e) =>
                  setEpisodes((rows) =>
                    rows.map((row, i) =>
                      i === index ? { ...row, episodeNumber: Number(e.target.value) || 1 } : row,
                    ),
                  )
                }
              />
            </label>
            <label className="min-w-[12rem] flex-1 text-caption text-ink-muted">
              {t("onlineEpisodeUrl")}
              <Input
                className="mt-1"
                value={ep.sourceUrl}
                onChange={(e) =>
                  setEpisodes((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, sourceUrl: e.target.value } : row)),
                  )
                }
              />
            </label>
            <label className="min-w-[8rem] flex-1 text-caption text-ink-muted">
              {t("onlineEpisodeTitle")}
              <Input
                className="mt-1"
                value={ep.title}
                onChange={(e) =>
                  setEpisodes((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, title: e.target.value } : row)),
                  )
                }
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              disabled={episodes.length <= 1}
              onClick={() => setEpisodes((rows) => rows.filter((_, i) => i !== index))}
            >
              {t("onlineRemoveEpisode")}
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            setEpisodes((rows) => [...rows, emptyEpisode((rows.at(-1)?.episodeNumber ?? 0) + 1)])
          }
        >
          {t("onlineAddEpisode")}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={createMut.isPending} onClick={() => createMut.mutate("LIVE")}>
          {t("onlineSubmit")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={createMut.isPending}
          onClick={() => createMut.mutate("DRAFT")}
        >
          {t("onlineSubmitDraft")}
        </Button>
      </div>
    </div>
  );
}
