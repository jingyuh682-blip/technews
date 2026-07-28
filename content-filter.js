/**
 * 新闻 / 热点共用：偏技术与产品，过滤广告、八卦、纯娱乐向
 */
const CONTENT_NOISE_RE =
  /优惠券?|限时优惠|折扣|免费领|免费送|扫码关注|扫码加|加微信|加群|进群|抽奖|拼团|带货|广告合作|推广文案?|购票|门票|VIP\s*通道|峰会报名|报名从速|名额有限|0\s*元学|体验课|训练营报名|课程售卖|招人啦|急聘|招聘|招募|招人|校招|社招|实习[生生]?招聘|招\s*实习|招\s*算法|内推|投递简历|投递通道|内推码|求职|简历模板|Cover\s*Letter|博士招生|研究生招生|招生简章|融资|获投|入股|Pre-?A|A轮|B轮|C轮|估值|股价|港股|美股|ETF|市值|胡润|财富榜|亿元|千万级|注册资本|持股|收购|减持|增持|出货量|销量同比|市占率|市场份额|内斗|逼宫|撕破脸|男女朋友|离婚|塌房|黑料|八卦|前女友|出轨|宫斗|欢迎关注本号|点赞在看|在看三连|求转发|转发抽|电影节|金鸡奖|奥斯卡|戛纳|影展|综艺节目|星光大道|电影短片|短片|短剧|微短剧|好莱坞|斩获|入围决赛|获奖名单|一等奖|公众号推荐|干货合集领取|为国争光|微博热议|网友热议|明星|恋情|分手|裁员名单|办公室政治|游戏本|轻薄本|开售|现货|直降|价保|到手价|\d+\s*元起|\d{4,}\s*元|(?:series\s*[A-D]\s*funding)|(?:raises?\s+\$)|(?:we're\s+hiring)|(?:now\s+hiring)|giveaway|discount\s+code|subscribe\s+now/i;

const TECH_PRODUCT_RE =
  /发布|上线|推出|亮相|首发|开源|论文|架构|算法|模型|评测|实测|benchmark|技术|产品|功能|更新|版本|原理|实现|优化|训练|推理|解读|详解|拆解|解析|API|SDK|框架|数据集|预训练|微调|部署|引擎|延迟|吞吐|量化|蒸馏|Agent|智能体|RAG|向量|提示词|工程实践|上手|指南|教程|源码|GitHub|论文解读|SOTA|开源代码|roadmap|changelog|release|正式版|预览版|公测|内测|能力|性能|参数|权重|checkpoint|推理速度|上下文|token|多模态|具身|自动驾驶|芯片|GPU|CUDA|算力|tool\s*use|function\s*call|MCP|插件|工作流|workflow|评测集|排行榜|开源模型|闭源模型|产品经理|需求分析|交互设计|体验设计|功能更新|新特性|能力升级|实践|案例|怎么用|如何做|底层|系统|方案|launch|open[\s-]?source|architecture|algorithm|inference|training|fine[\s-]?tun|deploy|feature|performance|research|paper|prototype|dataset|benchmark|model|product|update|SDK|API/i;

function isContentNoise(title, summary = '') {
  const t = `${title || ''} ${summary || ''}`;
  if (CONTENT_NOISE_RE.test(t)) return true;
  if (/^(欢迎关注|收藏本号|今日看点|早报来了)[.!！。]*$/i.test(String(title || '').trim())) return true;
  if (/^(招聘|招人|招实习生|融资|获投)/.test(String(title || '').trim())) return true;
  return false;
}

function hasTechOrProductSignal(title, summary = '') {
  return TECH_PRODUCT_RE.test(`${title || ''} ${summary || ''}`);
}

/** 新闻：非噪声，且偏技术/产品 */
function keepNewsItem(item) {
  if (!item || !item.title) return false;
  const title = item.title || '';
  const summary = item.summary || '';
  if (isContentNoise(title, summary)) return false;
  return hasTechOrProductSignal(title, summary);
}

module.exports = {
  CONTENT_NOISE_RE,
  TECH_PRODUCT_RE,
  isContentNoise,
  isHotNoise: isContentNoise,
  hasTechOrProductSignal,
  keepNewsItem
};
