import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { OpenaiService } from '../src/common/openai.service';

test('watermark vision request uses a high-detail image and strict schema', async () => {
  const originalFetch = global.fetch;
  let requestBody: any;
  global.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || '{}'));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                topLeft: {
                  found: true,
                  confidence: 0.91,
                  fullMark: { x: 0.1, y: 0.1, width: 0.2, height: 0.3 },
                  icon: { x: 0.11, y: 0.11, width: 0.18, height: 0.2 },
                },
                bottomRight: {
                  found: true,
                  confidence: 0.93,
                  fullMark: { x: 0.6, y: 0.6, width: 0.2, height: 0.3 },
                  icon: { x: 0.61, y: 0.61, width: 0.18, height: 0.2 },
                },
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    const service = new OpenaiService(
      new ConfigService({
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: 'https://example.test/v1',
        OPENAI_MODEL: 'text-model',
        WATERMARK_VISION_MODEL: 'vision-model',
      }),
    );
    const result = await service.locateReelShortWatermarks({
      topLeftImageBase64: 'aGVsbG8=',
      bottomRightImageBase64: 'd29ybGQ=',
      imageMime: 'image/jpeg',
      cropWidth: 388,
      cropHeight: 690,
    });

    assert.equal(result.model, 'vision-model');
    assert.equal(result.topLeft.confidence, 0.91);
    assert.equal(result.bottomRight.confidence, 0.93);
    assert.equal(requestBody.model, 'vision-model');
    assert.equal(
      requestBody.messages[1].content[1].image_url.url,
      'data:image/jpeg;base64,aGVsbG8=',
    );
    assert.equal(requestBody.messages[1].content[1].image_url.detail, 'high');
    assert.equal(
      requestBody.messages[1].content[3].image_url.url,
      'data:image/jpeg;base64,d29ybGQ=',
    );
    assert.equal(requestBody.response_format.type, 'json_schema');
    assert.equal(requestBody.response_format.json_schema.strict, true);
  } finally {
    global.fetch = originalFetch;
  }
});
