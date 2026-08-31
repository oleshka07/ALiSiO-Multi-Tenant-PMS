> For the complete documentation index, see [llms.txt](https://docs.channex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.channex.io/application-documentation/rooms-management.md).

# Rooms Management

## Create a Room

To start, click on "Create" button

```
You will see a create room form
please make sure to fill as much details as possible
```

![Create new room form](/files/-LgSJM-GxZ0OTcNWxtF4)

**Properties** - We auto fill this for you on the current property, make sure you are creating the room on the correct property

**Title** - This would be the name of the room/apartment/villa

**Count of Rooms** - If your a hotel or b\&b you might have multiple amounts fo rooms, please enter how many in total you have. If you are vacation rental then typically you will have 1 unit.

**Occupancy Settings**: This area is to specify how many a room/apartment can sleep

**Adult Spaces** - Please enter how many beds here for adults, we assume that children can sleep in adult spaces.

**Child Spaces** - Please only enter here if you have beds suitable only for children. We assume children can sleep in adult beds as default.

**Infant Spaces** - This is for Infant specific beds like "Cots" etc.

**Default Occupancy** - How many persons would typically occupy this room

## Room Type Content

We will keep content in the content tab for easy management, please set up everything and then fill the content last.

## Edit a Room

Editing a room is the same form as creating a room, click on the actions text then edit to edit your room.

## Create Rate

![Create a new rate on a specific room](/files/-LgSMOf695HRu94ewLyp)

* **Title** - Name of Rate
* **Property** - Choose for which property (Pre Filled)
* **Room Type** - For which Room you are creating a rate for (Pre Filled)

**Manual** - You will enter prices for the room manually.

**Derived** - The price & restriction will be derived from another room type. Please go to this link to see how this works.

### Price Settings - Manual Pricing - Per Room

![Price Settings](/files/-LgSOZ-69gg4M85pz6c-)

**Currency** - This is pre filled from your Property Setting.

**Sell Mode** - You can choose if it just a price for the room or price per person

**Rate** - If you choose "Per Room" there will be only one field here to enter the price for the room

### Price Settings - Manual Pricing - Per Person

![Manual Pricing Per Person](/files/-LgSQ89wKxOnNJnyFKxf)

Rate Mode:

* **Manual** - You will enter price per person manually as above
* **Derived** - You enter a price for the primary occupancy, then configure the modifier for the other occupancies.

![Derived Per Person](/files/-LgSQZ444I1oinKA2Rss)

#### Add Modifier

![Modifier per person rate](/files/-LgSR1LdbtjAOzWX9O_8)

Here you can choose how much percentage or fixed amount from the primary occupancy for the other occupancies.

{% hint style="info" %}
You can add multiple modifiers if you need per occupancy.

Example: Add 10% and $5
{% endhint %}

### Price Settings - Per Person - Auto

This is a faster way than derived to create your multi occupancy prices, you can enter your primary occupancy and how much cheaper or more expensive for different occupancy.

![Auto Mode](/files/-LgSRtn5xBei_Dv8lKZU)

{% hint style="info" %}
You can change the "increase/decrease" by percentage or amount
{% endhint %}

### Restrictions

![Set Rate Restrictions](/files/-LgSSHngIOVFF4G17AuT)

Here you can specify the defaults for the restrictions.

{% hint style="warning" %}
Once the rate is created you will manage all price, availability and restriction in inventory with bulk update.

If you change the rate settings it will only affect the inventory if you haven't changed via a update/bulk update.
{% endhint %}

## Derived Rate Create

![Create Derived Rate](/files/-LgSUmAkqLDVV9iqnXbc)

**Parent Rate Plan** - This is the room type you will derive price and restrictions from

**Inherit from Parents** - You will choose what to inherit from the parent.

Custom rate or restriction: You can unselect any box to manually set

![](/files/-LgSVLOVYW0ZSDuHlvMK)

### Price Settings - Derived

This is similar to manual except the rate is taken from another rate, you can add a modifier to the price.

![](/files/-LgSWBHBrIuei_2I6SVF)

Choose the primary occupancy and then the modifier for the other occupancy, we might autofill the modifiers from the parent to assist your setup.

### Price Settings - Auto

This is to make it simple to take a price from another rate plan and then add a modifier for the other occupancies.

### Price Settings - Cascade

![Cascade - Derived Setting](/files/-LgSWtcD4Y8OxLR_Ggc9)

{% hint style="info" %}
The derived option is great if you need to create a copy of the other rate plan but its like 10% cheaper.

Example: Non-Refundable Rate 10% cheaper per person.
{% endhint %}

##
