const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs");

const ecs = new ECSClient();

exports.handler = async (event) => {
  console.log("S3 Event:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(
      record.s3.object.key.replace(/\+/g, " ")
    );

    if (!key.toLowerCase().endsWith(".mp4")) {
      console.log(`Skipping non-MP4 file: ${key}`);
      continue;
    }

    console.log(`Triggering ECS task for: s3://${bucket}/${key}`);

    const result = await ecs.send(
      new RunTaskCommand({
        cluster: process.env.ECS_CLUSTER,
        taskDefinition: process.env.TASK_DEFINITION,
        launchType: "FARGATE",
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: process.env.SUBNETS.split(","),
            securityGroups: [process.env.SECURITY_GROUP],
            assignPublicIp: "ENABLED",
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: "video-processor",
              environment: [
                { name: "INPUT_BUCKET", value: bucket },
                { name: "INPUT_KEY", value: key },
                {
                  name: "OUTPUT_BUCKET",
                  value: process.env.OUTPUT_BUCKET || bucket,
                },
              ],
            },
          ],
        },
      })
    );

    console.log(
      "ECS task started:",
      result.tasks?.map((t) => t.taskArn)
    );
  }

  return { statusCode: 200, body: "Processing triggered" };
};
