import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const SAMPLE_ROOT =
  process.env.SAMPLE_ROOT || '/Users/ahs/Downloads/aidym宣传视频/历史成品';

// 为两部缺封面的样片补齐从视频里抽出的帧
const UPDATES = [
  {
    slug: 'mo-shou-shuang-lang',
    dir: '魔兽争霸；霜狼之子：荣耀觉醒',
    sourceFrame: '/tmp/cover_candidates/moshou_8s_1280.png',
  },
  {
    slug: 'xing-ji-zhui-xu',
    dir: '星际赘婿：地球男儿太抢手',
    sourceFrame: '/tmp/cover_candidates/xingji_18s_1280.png',
  },
];

async function main() {
  for (const u of UPDATES) {
    const folder = path.join(SAMPLE_ROOT, u.dir);
    if (!fs.existsSync(folder)) {
      console.log('[update-covers] 跳过，文件夹不存在:', folder);
      continue;
    }

    const coverFile = '封面.png';
    const dest = path.join(folder, coverFile);

    // 零拷贝失败——这是从 /tmp 生成的新文件，需要复制进去
    fs.copyFileSync(u.sourceFrame, dest);
    console.log('[update-covers] 复制封面:', dest);

    const coverUrl = `/api/v1/media/${encodeURIComponent(u.dir)}/${encodeURIComponent(coverFile)}`;

    const drama = await prisma.drama.update({
      where: { slug: u.slug },
      data: { coverUrl },
    });

    await prisma.episode.updateMany({
      where: { dramaId: drama.id },
      data: { thumbnailUrl: coverUrl },
    });

    console.log(
      `[update-covers] ${u.slug} → coverUrl 已更新，同时更新了 ${drama.totalEpisodes} 集的 thumbnailUrl`,
    );
  }
  console.log('[update-covers] done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
