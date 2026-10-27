import { describeCqCodes, hasRichContent, QQ_FACES } from "../src/cqcode.ts";

const tests = [
  '[CQ:face,id=467,raw={"faceText":"/摇花手"}]',
  "[CQ:image,summary=&#91;没事&#93;,file=674DC3610038264.jpg,sub_type=1]",
  "[CQ:at,qq=10001] 在吗",
  "[CQ:face,id=999]",
  "[CQ:record,file=abc.amr]",
];

for (const t of tests) {
  console.log(`${t.slice(0, 50)}`);
  console.log(`  → ${describeCqCodes(t)}`);
}

console.log(`\n表情表里有 ${Object.keys(QQ_FACES).length} 个 id`);
console.log(`判断富内容：${hasRichContent("[CQ:face,id=1]")} / ${hasRichContent("普通文字")}`);
