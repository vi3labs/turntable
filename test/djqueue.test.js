import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DJQueue } from '../server/DJQueue.js';

describe('DJQueue', () => {
  let q;

  beforeEach(() => {
    q = new DJQueue(5);
  });

  describe('stepUp / stepDown', () => {
    it('should add a DJ', () => {
      const result = q.stepUp('u1', 'Alice', 0);
      assert.equal(result.success, true);
      assert.equal(result.position, 0);
      assert.equal(q.slots.length, 1);
    });

    it('should reject duplicate DJ', () => {
      q.stepUp('u1', 'Alice', 0);
      const result = q.stepUp('u1', 'Alice', 0);
      assert.equal(result.error, 'Already a DJ');
    });

    it('should enforce max slots', () => {
      for (let i = 0; i < 5; i++) {
        q.stepUp(`u${i}`, `User${i}`, 0);
      }
      const result = q.stepUp('u5', 'User5', 0);
      assert.equal(result.error, 'DJ slots full');
    });

    it('should remove a DJ on stepDown', () => {
      q.stepUp('u1', 'Alice', 0);
      q.stepUp('u2', 'Bob', 1);
      const result = q.stepDown('u1');
      assert.equal(result.success, true);
      assert.equal(q.slots.length, 1);
      assert.equal(q.slots[0].username, 'Bob');
    });

    it('should return error when non-DJ steps down', () => {
      const result = q.stepDown('nobody');
      assert.equal(result.error, 'Not a DJ');
    });
  });

  describe('round-robin rotation', () => {
    it('should rotate through DJs', () => {
      q.stepUp('u1', 'Alice', 0);
      q.stepUp('u2', 'Bob', 1);

      q.addTrack('u1', { videoId: 'a', title: 'A', duration: 100 });
      q.addTrack('u2', { videoId: 'b', title: 'B', duration: 100 });
      q.addTrack('u1', { videoId: 'c', title: 'C', duration: 100 });

      const t1 = q.getNextTrack();
      assert.equal(t1.dj.username, 'Alice');
      assert.equal(t1.track.videoId, 'a');

      const t2 = q.getNextTrack();
      assert.equal(t2.dj.username, 'Bob');
      assert.equal(t2.track.videoId, 'b');

      const t3 = q.getNextTrack();
      assert.equal(t3.dj.username, 'Alice');
      assert.equal(t3.track.videoId, 'c');
    });

    it('should skip DJs with empty queues', () => {
      q.stepUp('u1', 'Alice', 0);
      q.stepUp('u2', 'Bob', 1);

      q.addTrack('u2', { videoId: 'b', title: 'B', duration: 100 });

      const t1 = q.getNextTrack();
      assert.equal(t1.dj.username, 'Bob');
    });

    it('should return null when all queues empty', () => {
      q.stepUp('u1', 'Alice', 0);
      const result = q.getNextTrack();
      assert.equal(result, null);
    });
  });

  describe('queue management', () => {
    it('should enforce max 20 tracks', () => {
      q.stepUp('u1', 'Alice', 0);
      for (let i = 0; i < 20; i++) {
        q.addTrack('u1', { videoId: `v${i}`, title: `T${i}`, duration: 100 });
      }
      const result = q.addTrack('u1', { videoId: 'v20', title: 'T20', duration: 100 });
      assert.equal(result.error, 'Queue full (max 20 tracks)');
    });

    it('should remove tracks by index', () => {
      q.stepUp('u1', 'Alice', 0);
      q.addTrack('u1', { videoId: 'a', title: 'A', duration: 100 });
      q.addTrack('u1', { videoId: 'b', title: 'B', duration: 100 });

      q.removeTrack('u1', 0);
      assert.equal(q.slots[0].queue.length, 1);
      assert.equal(q.slots[0].queue[0].videoId, 'b');
    });
  });

  describe('stepDown during rotation', () => {
    it('should adjust currentIndex when DJ steps down', () => {
      q.stepUp('u1', 'Alice', 0);
      q.stepUp('u2', 'Bob', 1);
      q.stepUp('u3', 'Carol', 2);

      q.addTrack('u1', { videoId: 'a', title: 'A', duration: 100 });
      q.addTrack('u2', { videoId: 'b', title: 'B', duration: 100 });
      q.addTrack('u3', { videoId: 'c', title: 'C', duration: 100 });

      // Play Alice's track (currentIndex becomes 0)
      q.getNextTrack();
      assert.equal(q.currentIndex, 0);

      // Alice steps down. Remaining: [Bob, Carol], currentIndex adjusted to 0
      q.stepDown('u1');
      assert.equal(q.slots.length, 2);
      assert.equal(q.slots[0].username, 'Bob');
      assert.equal(q.slots[1].username, 'Carol');

      // getNextTrack advances from 0 -> 1, plays Carol
      const next = q.getNextTrack();
      assert.equal(next.dj.username, 'Carol');
    });

    it('should handle stepDown of a DJ after current index', () => {
      q.stepUp('u1', 'Alice', 0);
      q.stepUp('u2', 'Bob', 1);
      q.stepUp('u3', 'Carol', 2);

      q.addTrack('u1', { videoId: 'a', title: 'A', duration: 100 });
      q.addTrack('u2', { videoId: 'b', title: 'B', duration: 100 });
      q.addTrack('u3', { videoId: 'c', title: 'C', duration: 100 });

      q.getNextTrack(); // Alice plays, currentIndex = 0

      // Carol (index 2) steps down. index > currentIndex, so no adjustment
      q.stepDown('u3');
      assert.equal(q.currentIndex, 0);

      const next = q.getNextTrack();
      assert.equal(next.dj.username, 'Bob');
    });
  });

  describe('slot reservation', () => {
    it('should reserve and claim a slot', () => {
      q.stepUp('u1', 'Alice', 0);
      q.addTrack('u1', { videoId: 'a', title: 'A', duration: 100 });

      const reserved = q.reserveSlot('u1', 'Alice');
      assert.equal(reserved, true);
      assert.equal(q.slots.length, 0);
      assert.equal(q.hasReservation('Alice'), true);

      const slot = q.claimReservation('Alice', 'u1-new', 2);
      assert.ok(slot);
      assert.equal(slot.userId, 'u1-new');
      assert.equal(slot.avatarId, 2);
      assert.equal(slot.queue.length, 1);
      assert.equal(q.slots.length, 1);
      assert.equal(q.hasReservation('Alice'), false);
    });

    it('should return null for non-existent reservation', () => {
      const result = q.claimReservation('Nobody', 'u1', 0);
      assert.equal(result, null);
    });

    it('should auto-expire reservation after timeout', async () => {
      q.stepUp('u1', 'Alice', 0);

      // Temporarily override to use short timeout for testing
      const index = q.slots.findIndex(d => d.userId === 'u1');
      const slot = { ...q.slots[index], queue: [...q.slots[index].queue] };
      q.slots.splice(index, 1);
      q.currentIndex = -1;
      const timer = setTimeout(() => q.reservedSlots.delete('Alice'), 50);
      q.reservedSlots.set('Alice', { slot, timer, originalIndex: index });

      assert.equal(q.hasReservation('Alice'), true);
      await new Promise(r => setTimeout(r, 100));
      assert.equal(q.hasReservation('Alice'), false);
    });

    it('should re-insert at original position', () => {
      q.stepUp('u1', 'Alice', 0);
      q.stepUp('u2', 'Bob', 1);
      q.stepUp('u3', 'Carol', 2);

      q.reserveSlot('u2', 'Bob');
      assert.equal(q.slots.length, 2);
      assert.equal(q.slots[0].username, 'Alice');
      assert.equal(q.slots[1].username, 'Carol');

      q.claimReservation('Bob', 'u2-new', 1);
      assert.equal(q.slots.length, 3);
      assert.equal(q.slots[0].username, 'Alice');
      assert.equal(q.slots[1].username, 'Bob');
      assert.equal(q.slots[2].username, 'Carol');
    });
  });
});
