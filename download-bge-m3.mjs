const hfEndpoint = process.env.HF_ENDPOINT || "https://hf-mirror.com";

async function main() {
  const transformers = await import("@xenova/transformers");
  transformers.env.remoteHost = hfEndpoint.endsWith("/") ? hfEndpoint : hfEndpoint + "/";
  transformers.env.allowLocalModels = false;
  console.log(`Downloading bge-m3 Q4 from ${transformers.env.remoteHost}...`);
  
  const extractor = await transformers.pipeline("feature-extraction", "Xenova/bge-m3", { quantized: true });
  console.log("Download complete!");
  const test = await extractor("测试", { pooling: "mean", normalize: true });
  console.log(`Vector dims: ${test.dims[1]}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
