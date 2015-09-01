getAccessToken = function(userId) {
    try {
        var user = Meteor.users.findOne(userId);
        return user.services.slack.accessToken;
    } catch(e) {
        return null;
    }
};

slackMethod = function(options) {
    return function(args) {
        args = args || {};
        var token = args.token || getAccessToken(this.userId);
        if (!token) {
            throw new Error("User is not authenticated with Slack");
        }

        _.extend(args, {token: token});
        console.log('args', args);

        var response;
        try {
            response = HTTP.call(options.method, options.url,{
                params: args
            });
        } catch (e) {
            console.log('Request Error', e);
            throw new Error("Request Error");
        }

        console.log('response', response);
        if (response.statusCode === 200) {
            if (options.parser){
                return options.parser(response.data);
            } else {
                return response.data;
            }
        } else {
            throw new Error("Received response code " + response.statusCode);
        }
    };
};

// Methods
Meteor.methods({
    'slack-search': slackMethod({
        method: 'GET',
        url: 'https://slack.com/api/search.messages',
        parser: function (data) {
            return data.messages;
        }
    }),
    'slack-team': slackMethod({
        method: 'GET',
        url: 'https://slack.com/api/users.list',
        parser: function (data) {
            return data.members;
        }
    }),
    'slack-hook': function(text) {
        var team = TeamCollection.findOne({id: Meteor.user().profile.team_id});
        if (!team.webhook) {
            throw new Meteor.Error('No hook configured for this team');
        }

        HTTP.post(team.webhook, { // TODO Save this url in db and allow to change it in settings
            data: {
                icon_emoji: "http://quoteoftheday.meteor.com/icon.png",
                username: 'Quote of the day',
                text: text
            }
        });
    },
    'setQuote': function(quote) {
        if (!Meteor.user()) {
            throw new Meteor.Error('You must login with slack first');
        }

        var start = new Date();
        start.setHours(0);
        var end = new Date();
        end.setHours(23);
        var todayQuote = QuotesCollection.findOne({
            teamId: Meteor.user().profile.team_id,
            day: {
                $gte: start,
                $lte: end
            }
        });

        if (todayQuote) {
            throw new Meteor.Error('Only one quote is possible per day')
        }

        QuotesCollection.insert({
            quote: quote,
            day: new Date(),
            teamId: Meteor.user().profile.team_id
        });

        // Send message to slack channel
        Meteor.call('slack-hook', {
            text: '"'+quote.text+'" par <@'+quote.username+'>' // TODO Allow user to change the format
        });

        return true;
    },
    'setHook': function(webhook) {
        check(webhook, String);

        if (!Meteor.user()) {
            throw new Meteor.Error('You must login with slack first');
        }

        var team = TeamCollection.findOne({id: Meteor.user().profile.team_id});
        if (!team) {
            throw new Meteor.Error('No team associated with this user');
        }

        TeamCollection.update(team._id, {$set:{webhook: webhook}});
    },
    'deleteQuote': function(id) {
        check(id, String);
        QuotesCollection.remove({_id: id});
        return true;
    },
    'fetchTeamMember': function(user) {
        if (Match.test(user, String)) {
            user = Meteor.users.findOne(user);
        }

        var teamId = user.profile.team_id;
        var team = TeamCollection.findOne({id: teamId});

        if (!team) {
            // TODO Fetch team data
            TeamCollection.insert({id: teamId});

            // Fetch team meber
            Meteor.call('slack-team', {token: user.services.slack.accessToken}, function (error, members) {
                _.each(members, function (member) {
                    member.teamId = teamId;
                    TeamMemberCollection.insert(member);
                });
            });
        }
    }
});

// Events
Accounts.onCreateUser(function(options, user) {
    if (options.profile) {
        user.profile = options.profile;
    }

    Meteor.call('fetchTeamMember', user);
    return user;
});

// Pub / sub
Meteor.publish('quoteOfTheDay', function (teamId) {
    var start = new Date();
    start.setHours(0);
    start.setMinutes(0);
    start.setSeconds(0);
    var end = new Date();
    end.setHours(24);
    end.setMinutes(0);
    end.setSeconds(0);

    return QuotesCollection.find({
        teamId: teamId,
        day: {
            $gte: start,
            $lte: end
        }
    });
});

Meteor.publish('quotes', function (teamId) {
    // TODO Security check team id of logged user
    return QuotesCollection.find({
        teamId: teamId
    });
});

Meteor.publish('team', function (teamId) {
    // TODO Security check team id of logged user
    return TeamCollection.find({
        id: teamId
    });
});

Meteor.publish('members', function (teamId) {
    // TODO Security check team id of logged user
    return TeamMemberCollection.find({
        teamId: teamId
    });
});
