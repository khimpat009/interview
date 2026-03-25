const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const fs = require("fs");
const { pipeline } = require("stream/promises");

const s3 = new S3Client();

async function downloadFile(bucket, key, destPath) {
  const { Body } = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  await pipeline(Body, fs.createWriteStream(destPath));
  console.log(`Downloaded s3://${bucket}/${key} → ${destPath}`);
}

async function uploadFile(bucket, key, filePath) {
  const body = fs.createReadStream(filePath);
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body })
  );
  console.log(`Uploaded ${filePath} → s3://${bucket}/${key}`);
}

async function uploadJson(bucket, key, data) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: "application/json",
    })
  );
  console.log(`Uploaded JSON → s3://${bucket}/${key}`);
}

module.exports = { downloadFile, uploadFile, uploadJson };
