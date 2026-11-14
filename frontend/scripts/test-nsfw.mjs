import * as nsfw from 'nsfwjs';
import * as tf from '@tensorflow/tfjs';

async function test() {
  console.log('Loading nsfw model...');
  const model = await nsfw.load();
  console.log('Model loaded:', Boolean(model));
  // Create a dummy tensor of shape [1, 224, 224, 3]
  const dummyTensor = tf.zeros([224, 224, 3]);
  const predictions = await model.classify(dummyTensor);
  console.log('Predictions on dummy tensor:', predictions);
  dummyTensor.dispose();
}

test().catch(console.error);
