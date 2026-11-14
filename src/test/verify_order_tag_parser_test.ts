import assert from 'assert';
import { extractExternalOrderIdAndCleanNotes as backendParser } from '../services/orderParsingUtils';

console.log('=== VERIFYING ORDER TAG PARSER ===');

// Test 1: Double-quoted title tag and order id
const input1 = '<t="My Title"> <#ORD99> Fast run';
const result1 = backendParser(input1);
console.log('Input:', input1);
console.log('Output:', result1);

assert.strictEqual(result1.title, 'My Title', 'Title should be parsed as "My Title"');
assert.strictEqual(result1.externalOrderId, 'ORD99', 'externalOrderId should be "ORD99"');
assert.strictEqual(result1.cleanNotes, 'Fast run', 'cleanNotes should be "Fast run"');
console.log('✅ Test 1 Passed: <t="My Title"> <#ORD99> Fast run');

// Test 2: Single-quoted title and reverse order
const input2 = '<#ORD100> <t=\'Mythic 10 Ara-Kara\'> Only pumpers';
const result2 = backendParser(input2);
assert.strictEqual(result2.title, 'Mythic 10 Ara-Kara');
assert.strictEqual(result2.externalOrderId, 'ORD100');
assert.strictEqual(result2.cleanNotes, 'Only pumpers');
console.log('✅ Test 2 Passed: Single quotes & reversed tag order');

// Test 3: Unquoted title tag
const input3 = '<t=Speed Run 15> <#EX55> No wipe';
const result3 = backendParser(input3);
assert.strictEqual(result3.title, 'Speed Run 15');
assert.strictEqual(result3.externalOrderId, 'EX55');
assert.strictEqual(result3.cleanNotes, 'No wipe');
console.log('✅ Test 3 Passed: Unquoted tag format');

// Test 4: Explicit parameters override while stripping from notes
const input4 = '<t="Tag Title"> <#TAGID> Just notes';
const result4 = backendParser(input4, 'EXPLICIT_ID', 'Explicit Title');
assert.strictEqual(result4.title, 'Explicit Title');
assert.strictEqual(result4.externalOrderId, 'EXPLICIT_ID');
assert.strictEqual(result4.cleanNotes, 'Just notes');
console.log('✅ Test 4 Passed: Explicit form parameters override parsed tags with tags cleanly stripped');

console.log('\n🎉 ALL 4 PARSER TESTS PASSED PERFECTLY!\n');
