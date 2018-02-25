'use strict'

/**
 * adonis-websocket
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

const test = require('japa')

const Channel = require('../../src/Channel')
const Manager = require('../../src/Channel/Manager')
const Socket = require('../../src/Socket')

const helpers = require('../helpers')
const FakeConnection = helpers.getFakeConnection()

test.group('Channel', () => {
  test('throw exception when channel doesn\'t have a name', (assert) => {
    const channel = () => new Channel()
    assert.throw(channel, 'E_INVALID_PARAMETER: Expected channel name to be string')
  })

  test('throw exception when channel doesn\'t have a onConnect callback', (assert) => {
    const channel = () => new Channel('foo')
    assert.throw(channel, 'E_INVALID_PARAMETER: Expected channel callback to be a function')
  })

  test('save topic and socket reference onJoin call', async (assert) => {
    const channel = new Channel('foo', function () {})
    const ctx = {
      socket: new Socket('foo', new FakeConnection())
    }
    await channel.joinTopic(ctx)
    assert.deepEqual(channel.subscriptions.get('foo'), new Set([ctx.socket]))
  })

  test('save topic and multiple socket references', async (assert) => {
    const channel = new Channel('foo', function () {})
    const ctx = {
      socket: new Socket('foo', new FakeConnection())
    }

    const ctx1 = {
      socket: new Socket('foo', new FakeConnection())
    }

    await channel.joinTopic(ctx)
    await channel.joinTopic(ctx1)
    assert.deepEqual(channel.subscriptions.get('foo'), new Set([ctx.socket, ctx1.socket]))
  })

  test('adding subscription to same topic for multiple times must have no impact', async (assert) => {
    const channel = new Channel('foo', function () {})
    const ctx = {
      socket: new Socket('foo', new FakeConnection())
    }

    await channel.joinTopic(ctx)
    await channel.joinTopic(ctx)
    assert.deepEqual(channel.subscriptions.get('foo'), new Set([ctx.socket]))
  })

  test('call channel onConnect fn when channel topic is joined', (assert, done) => {
    assert.plan(1)

    const ctx = {
      socket: new Socket('foo', new FakeConnection())
    }
    const channel = new Channel('foo', function (context) {
      done(() => {
        assert.deepEqual(context, ctx)
      })
    })
    channel.joinTopic(ctx)
  })

  test('remove socket reference when leaveTopic is called', async (assert) => {
    const ctx = {
      socket: new Socket('foo', new FakeConnection())
    }

    const channel = new Channel('foo', function () {})
    await channel.joinTopic(ctx)

    assert.equal(channel.subscriptions.size, 1)
    assert.equal(channel.subscriptions.get('foo').size, 1)

    channel.deleteSubscription(ctx.socket)
    assert.equal(channel.subscriptions.size, 1)
    assert.equal(channel.subscriptions.get('foo').size, 0)
  })

  test('execute middleware before joiningTopic', (assert, done) => {
    const ctx = {
      socket: new Socket('foo', new FakeConnection()),
      joinStack: []
    }

    const channel = new Channel('foo', function (__ctx__) {
      __ctx__.joinStack.push(3)
    })

    channel
      .middleware(async (__ctx__, next) => {
        __ctx__.joinStack.push(1)
        await next()
      })
      .middleware(async (__ctx__, next) => {
        __ctx__.joinStack.push(2)
        await next()
      })

    channel
      .joinTopic(ctx)
      .then(() => {
        process.nextTick(() => {
          assert.deepEqual(ctx.joinStack, [1, 2, 3])
          done()
        })
      })
  })

  test('do not join topic when middleware throws exception', async (assert) => {
    assert.plan(2)

    const ctx = {
      socket: new Socket('foo', new FakeConnection())
    }

    const channel = new Channel('foo', function () {})

    channel
      .middleware(async (__ctx__) => {
        throw new Error('Cannot join topic')
      })

    try {
      await channel.joinTopic(ctx)
    } catch ({ message }) {
      assert.equal(channel.subscriptions.size, 0)
      assert.equal(message, 'Cannot join topic')
    }
  })
})

test.group('Channel Manager', (group) => {
  group.beforeEach(() => {
    Manager.clear()
  })

  test('add a new channel', (assert) => {
    Manager.add('chat', function () {})
    assert.instanceOf(Manager.channels.get('chat'), Channel)
    assert.equal(Manager.channels.get('chat').name, 'chat')
  })

  test('remove starting slash from name', (assert) => {
    Manager.add('/chat', function () {})
    assert.instanceOf(Manager.channels.get('chat'), Channel)
    assert.equal(Manager.channels.get('chat').name, 'chat')
  })

  test('remove trailing slash', (assert) => {
    Manager.add('chat/', function () {})
    assert.instanceOf(Manager.channels.get('chat'), Channel)
    assert.equal(Manager.channels.get('chat').name, 'chat')
  })

  test('do not remove intermediate slashes', (assert) => {
    Manager.add('user/chat', function () {})
    assert.instanceOf(Manager.channels.get('user/chat'), Channel)
    assert.equal(Manager.channels.get('user/chat').name, 'user/chat')
  })

  test('generate channel name regex for matching topics', (assert) => {
    Manager.add('chat', function () {})
    assert.deepEqual(Manager._channelExpressions, [
      {
        expression: /^chat$/,
        name: 'chat'
      }
    ])
  })

  test('generate channel name regex for wildcard', (assert) => {
    Manager.add('chat:*', function () {})
    assert.deepEqual(Manager._channelExpressions, [
      {
        expression: /^chat:\w+/,
        name: 'chat:*'
      }
    ])
  })

  test('only entertain the last wildcard', (assert) => {
    Manager.add('chat:*:foo:*', function () {})
    assert.deepEqual(Manager._channelExpressions, [
      {
        expression: /^chat:*:foo:\w+/,
        name: 'chat:*:foo:*'
      }
    ])
  })

  test('resolve channel by matching topic', (assert) => {
    const channel = Manager.add('chat/*', function () {})
    assert.deepEqual(Manager.resolve('chat/watercooler'), channel)
  })

  test('return null when unable to resolve topic', (assert) => {
    Manager.add('chat:*', function () {})
    assert.isNull(Manager.resolve('foo'))
  })

  test('do not match dynamic topics when wildcard is not defined', (assert) => {
    Manager.add('chat', function () {})
    assert.isNull(Manager.resolve('chat:watercooler'))
  })
})