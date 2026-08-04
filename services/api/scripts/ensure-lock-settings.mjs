import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const keep = ["episodeLockMode", "defaultFreeEpisodes"];
await p.systemSetting.deleteMany({ where: { key: { notIn: keep } } });
await p.systemSetting.upsert({
  where: { key: "episodeLockMode" },
  create: { key: "episodeLockMode", value: "FREE_FIRST_N" },
  update: {},
});
await p.systemSetting.upsert({
  where: { key: "defaultFreeEpisodes" },
  create: { key: "defaultFreeEpisodes", value: 3 },
  update: {},
});
const cols = await p.$queryRawUnsafe(
  "SELECT column_name FROM information_schema.columns WHERE table_name='dramas' AND column_name='lockMode'",
);
const settings = await p.systemSetting.findMany({
  where: { key: { in: keep } },
});
console.log("lockMode column", cols);
console.log("settings", settings);
await p.$disconnect();
