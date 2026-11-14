import * as nsfw from 'nsfwjs';
import * as tf from '@tensorflow/tfjs';

async function testClassifier() {
  console.log('Loading NSFWJS model...');
  const model = await nsfw.load();
  console.log('Model loaded successfully.');

  // Test 1: Zero / black tensor
  const zeros = tf.zeros([224, 224, 3]);
  const res1 = await model.classify(zeros);
  console.log('Test 1 (Black image):', res1.map(p => `${p.className}: ${p.probability.toFixed(3)}`).join(', '));
  zeros.dispose();

  // Test 2: Random noise
  const noise = tf.randomUniform([224, 224, 3], 0, 255);
  const res2 = await model.classify(noise);
  console.log('Test 2 (Noise image):', res2.map(p => `${p.className}: ${p.probability.toFixed(3)}`).join(', '));
  noise.dispose();

  // Test 3: Neutral color (grey)
  const grey = tf.fill([224, 224, 3], 128);
  const res3 = await model.classify(grey);
  console.log('Test 3 (Grey image):', res3.map(p => `${p.className}: ${p.probability.toFixed(3)}`).join(', '));
  grey.dispose();
}

testClassifier().catch(console.error);
