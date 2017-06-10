import { Group, Message, User } from './connectors';

// reusable function to check for a user with context
function getAuthenticatedUser(ctx) {
  return ctx.user.then((user) => {
    if (!user) {
      return Promise.reject('Unauthorized');
    }
    return user;
  });
}

export const messageLogic = {
  from(message, args, ctx) {
    if (!ctx.userLoader) {
      return message.getUser({ attributes: ['id', 'username'] });
    }
    return ctx.userLoader.load(message.userId).then(({ id, username }) => ({ id, username }));
  },
  to(message, args, ctx) {
    if (!ctx.groupLoader) {
      return message.getGroup({ attributes: ['id', 'name'] });
    }
    return ctx.groupLoader.load(message.groupId).then(({ id, name }) => ({ id, name }));
  },
  createMessage(_, createMessageInput, ctx) {
    const { text, groupId } = createMessageInput.message;

    return getAuthenticatedUser(ctx)
      .then(user => user.getGroups({ where: { id: groupId }, attributes: ['id'] })
      .then((group) => {
        if (group.length) {
          return Message.create({
            userId: user.id,
            text,
            groupId,
          });
        }
        return Promise.reject('Unauthorized');
      }));
  },
};

export const groupLogic = {
  users(group) {
    return group.getUsers({ attributes: ['id', 'username'] });
  },
  messages(group, args) {
    return Message.findAll({
      where: { groupId: group.id },
      order: [['createdAt', 'DESC']],
      limit: args.limit,
      offset: args.offset,
    });
  },
  lastRead(group, args, ctx) {
    return getAuthenticatedUser(ctx)
      .then(user => user.getLastRead({ where: { groupId: group.id } }))
      .then((lastRead) => {
        if (lastRead.length) {
          return lastRead[0];
        }

        return null;
      });
  },
  unreadCount(group, args, ctx) {
    return getAuthenticatedUser(ctx)
      .then(user => user.getLastRead({ where: { groupId: group.id } }))
      .then((lastRead) => {
        if (!lastRead.length) {
          return Message.count({ where: { groupId: group.id } });
        }

        return Message.count({
          where: {
            groupId: group.id,
            createdAt: { $gt: lastRead[0].createdAt },
          },
        });
      });
  },
  query(_, { id }, ctx) {
    return getAuthenticatedUser(ctx).then(user => Group.findOne({
      where: { id },
      include: [{
        model: User,
        where: { id: user.id },
      }],
    }));
  },
  createGroup(_, createGroupInput, ctx) {
    const { name, userIds } = createGroupInput.group;

    return getAuthenticatedUser(ctx)
      .then(user => user.getFriends({ where: { id: { $in: userIds } } })
      .then((friends) => {  // eslint-disable-line arrow-body-style
        return Group.create({
          name,
        }).then((group) => {  // eslint-disable-line arrow-body-style
          return group.addUsers([user, ...friends]).then(() => {
            group.users = [user, ...friends];
            return group;
          });
        });
      }));
  },
  deleteGroup(_, { id }, ctx) {
    return getAuthenticatedUser(ctx).then((user) => { // eslint-disable-line arrow-body-style
      return Group.findOne({
        where: { id },
        include: [{
          model: User,
          where: { id: user.id },
        }],
      }).then(group => group.getUsers()
        .then(users => group.removeUsers(users))
        .then(() => Message.destroy({ where: { groupId: group.id } }))
        .then(() => group.destroy()));
    });
  },
  leaveGroup(_, { id }, ctx) {
    return getAuthenticatedUser(ctx).then((user) => {
      if (!user) {
        return Promise.reject('Unauthorized');
      }

      return Group.findOne({
        where: { id },
        include: [{
          model: User,
          where: { id: user.id },
        }],
      }).then((group) => {
        if (!group) {
          Promise.reject('No group found');
        }

        return group.removeUser(user.id)
          .then(() => group.getUsers())
          .then((users) => {
            // if the last user is leaving, remove the group
            if (!users.length) {
              group.destroy();
            }
            return { id };
          });
      });
    });
  },
  updateGroup(_, updateGroupInput, ctx) {
    const { id, name, lastRead } = updateGroupInput.group;

    return getAuthenticatedUser(ctx).then((user) => {  // eslint-disable-line arrow-body-style
      return Group.findOne({
        where: { id },
        include: [{
          model: User,
          where: { id: user.id },
        }],
      }).then((group) => {
        let lastReadPromise = (options = {}) => Promise.resolve(options);
        if (lastRead) {
          lastReadPromise = (options = {}) => user.getLastRead({ where: { groupId: id } })          
            .then(oldLastRead => user.removeLastRead(oldLastRead))
            .then(user.addLastRead(lastRead))
            .then(() => options);
        }

        let namePromise = options => Promise.resolve(options);
        if (name) {
          namePromise = options => Object.assign(options, { name });
        }

        return lastReadPromise()
          .then(opts => namePromise(opts))
          .then(opts => group.update(opts));
      });
    });
  },
};

export const userLogic = {
  email(user, args, ctx) {
    return getAuthenticatedUser(ctx).then((currentUser) => {
      if (currentUser.id === user.id) {
        return currentUser.email;
      }

      return Promise.reject('Unauthorized');
    });
  },
  friends(user, args, ctx) {
    return getAuthenticatedUser(ctx).then((currentUser) => {
      if (currentUser.id !== user.id) {
        return Promise.reject('Unauthorized');
      }

      return user.getFriends({ attributes: ['id', 'username'] });
    });
  },
  groups(user, args, ctx) {
    return getAuthenticatedUser(ctx).then((currentUser) => {
      if (currentUser.id !== user.id) {
        return Promise.reject('Unauthorized');
      }

      return user.getGroups();
    });
  },
  jwt(user) {
    return Promise.resolve(user.jwt);
  },
  messages(user, args, ctx) {
    return getAuthenticatedUser(ctx).then((currentUser) => {
      if (currentUser.id !== user.id) {
        return Promise.reject('Unauthorized');
      }

      return Message.findAll({
        where: { userId: user.id },
        order: [['createdAt', 'DESC']],
      });
    });
  },
  query(_, args, ctx) {
    return getAuthenticatedUser(ctx).then((user) => {
      if (user.id === args.id || user.email === args.email) {
        return user;
      }

      return Promise.reject('Unauthorized');
    });
  },
};

export const subscriptionLogic = {
  groupAdded(baseParams, args, ctx) {
    return getAuthenticatedUser(ctx)
      .then((user) => {
        if (user.id !== args.userId) {
          return Promise.reject('Unauthorized');
        }

        baseParams.context = ctx;
        return baseParams;
      });
  },
  messageAdded(baseParams, args, ctx) {
    return getAuthenticatedUser(ctx)
      .then(user => user.getGroups({ where: { id: { $in: args.groupIds } }, attributes: ['id'] })
      .then((groups) => {
        // user attempted to subscribe to some groups without access
        if (args.groupIds.length > groups.length) {
          return Promise.reject('Unauthorized');
        }

        baseParams.context = ctx;
        return baseParams;
      }));
  },
};
