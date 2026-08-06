"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminCreateOnlineDrama, adminListCategories } from "@velvet/api-client";
import { Button, Input, Select } from "@velvet/ui";
import { DramaCoverField } from "@/components/drama-cover-field";
import { contentDetailHref } from "@/lib/content-href";
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
  const router = useRouter();
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
    mutationFn: () => {
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
        status: "DRAFT",
        // Align with yt-dlp import: accept signed/CDN URLs without file extension.
        relaxedPlayUrl: true,
        episodes: all,
      });
    },
    onSuccess: (data) => {
      setError(null);
      setCreatedId(data.id);
      setCreatedCount(data.totalEpisodes);
      router.push(contentDetailHref(data.id, "info"));
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-4">
      {error ? <p className="text-body-sm text-danger">{error}</p> : null}
      {createdId ? (
        <div className="upload-panel space-y-2 text-body-sm">
          <p>{t("onlineCreatedDraft", { n: createdCount })}</p>
          <p className="text-caption text-ink-muted">{t("onlineNextRightsHint")}</p>
          <button
            type="button"
            className="font-medium text-brand hover:underline"
            onClick={() => router.push(contentDetailHref(createdId, "info"))}
          >
            {t("onlineOpenForRights")}
          </button>
        </div>
      ) : null}

      <div className="upload-panel grid gap-3 md:grid-cols-2">
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
        <div className="text-caption text-ink-muted md:col-span-2">
          <span className="mb-1 block">{t("uploadSectionCover")}</span>
          <DramaCoverField
            url={coverUrl || undefined}
            disabled={createMut.isPending}
            videoSrc={episodes.find((ep) => ep.sourceUrl.trim())?.sourceUrl || undefined}
            videoIsHls={/\.m3u8(\?|$)/i.test(
              episodes.find((ep) => ep.sourceUrl.trim())?.sourceUrl || "",
            )}
            onChange={setCoverUrl}
            onError={setError}
          />
        </div>
        <label className="text-caption text-ink-muted md:col-span-2">
          {t("onlineDescZh")}
          <textarea
            className="mt-1 min-h-20 w-full rounded-md border border-line bg-surface px-3 py-2 text-body-sm"
            value={descriptionZh}
            onChange={(e) => setDescriptionZh(e.target.value)}
          />
        </label>
      </div>

      <div className="upload-panel space-y-3">
        <div>
          <h3 className="text-h4 font-semibold">{t("onlineEpisodesTitle")}</h3>
          <p className="text-body-sm text-ink-muted">{t("onlineEpisodesHint")}</p>
        </div>
        <label className="block text-caption text-ink-muted">
          {t("onlineEpisodesBulk")}
          <textarea
            className="mt-1 min-h-24 w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-caption"
            placeholder={"https://cdn.example.com/ep1/index.m3u8\nhttps://cdn.example.com/ep2.mp4?token=…"}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
          />
        </label>
        <p className="text-caption text-ink-muted">{t("onlineManualUrlTip")}</p>
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

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={createMut.isPending} onClick={() => createMut.mutate()}>
          {t("onlineSubmitDraft")}
        </Button>
        <p className="text-caption text-ink-muted">{t("onlineDraftOnlyHint")}</p>
      </div>
    </div>
  );
}
